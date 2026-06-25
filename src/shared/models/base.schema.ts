import { Schema, type SchemaDefinition, type SchemaOptions } from 'mongoose';

/**
 * Reusable Mongoose schema factory.
 *
 * Every model SHOULD be created through `createBaseSchema` so the project
 * has a single source of truth for:
 *  - `timestamps: true`   → automatic `createdAt` + `updatedAt`,
 *  - **soft delete**     → `isDeleted` + `deletedAt` columns + a default
 *                          query filter that hides soft-deleted documents
 *                          (use `.setOptions({ withDeleted: true })` to opt
 *                          back in, e.g. for admin audit trails),
 *  - **transformed JSON**→ Mongoose `__v` removed, `_id` projected as `id`
 *                          so the wire shape is stable for every collection,
 *  - **toObject parity** → same transform applied to `.toObject()`.
 *
 * Feature schemas should never re-implement these concerns.
 */
export interface BaseDocFields {
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const transformDocument = (
  _doc: unknown,
  ret: Record<string, unknown>,
): Record<string, unknown> => {
  ret.id = ret._id;
  delete ret._id;
  delete ret.__v;
  // Never leak password hashes / sensitive token columns.
  delete ret.passwordHash;
  delete ret.tokenHash;
  return ret;
};

export const createBaseSchema = <TDoc>(
  definition: SchemaDefinition<TDoc>,
  options: SchemaOptions<TDoc> = {},
): Schema<TDoc> => {
  const schema = new Schema<TDoc>(
    {
      ...(definition as SchemaDefinition<TDoc>),
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    } as SchemaDefinition<TDoc>,
    {
      timestamps: true,
      versionKey: false,
      toJSON: { virtuals: true, transform: transformDocument },
      toObject: { virtuals: true, transform: transformDocument },
      ...options,
    },
  );

  // ─── Soft-delete default scope ──────────────────────────────────────────
  // Apply to all common read operations. Callers that legitimately need
  // tombstones (admin tooling, GDPR exports) pass `{ withDeleted: true }`
  // and we strip the filter clause again.
  const READ_HOOKS = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'count',
    'countDocuments',
    'updateOne',
    'updateMany',
  ] as const;

  for (const hook of READ_HOOKS) {
    schema.pre(hook, function applySoftDeleteFilter(next) {
      const q = this as unknown as {
        getOptions: () => { withDeleted?: boolean };
        getFilter: () => Record<string, unknown>;
        where: (path: string) => { equals: (v: unknown) => unknown };
      };
      const { withDeleted } = q.getOptions();
      if (withDeleted) return next();
      const filter = q.getFilter();
      if (filter.isDeleted === undefined) q.where('isDeleted').equals(false);
      next();
    });
  }

  return schema;
};

/**
 * Helper for repositories: turns a Mongoose document into the canonical
 * JSON shape (with `id`, soft-delete fields preserved). Mostly used by
 * tests / serializers that need an inert payload.
 */
export const toPlain = <T>(doc: { toJSON: () => T } | null): T | null =>
  doc ? doc.toJSON() : null;
