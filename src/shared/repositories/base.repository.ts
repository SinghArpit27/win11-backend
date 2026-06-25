import {
  ClientSession,
  FilterQuery,
  HydratedDocument,
  Model,
  PipelineStage,
  PopulateOptions,
  ProjectionType,
  QueryOptions,
  RootFilterQuery,
  Types,
  UpdateQuery,
} from 'mongoose';

import type { Paginated, PaginationParams } from '@common/types/common.types';
import { buildPaginationMeta } from '@common/utils/pagination.util';

/**
 * Generic, reusable repository implementing common CRUD + pagination.
 *
 * SOLID:
 *  - Single responsibility: data access only — no business rules.
 *  - Open/closed:           extend per-module by sub-classing.
 *  - Liskov substitutable:  every feature repo can be swapped for `BaseRepository`
 *                           in tests/mocks because the public contract is stable.
 *  - Interface segregation: methods are small and orthogonal.
 *  - Dependency inversion:  feature services depend on the abstract base, not on
 *                           Mongoose directly.
 */
export abstract class BaseRepository<TDoc extends { _id: Types.ObjectId | string }> {
  protected constructor(protected readonly model: Model<TDoc>) {}

  // ─── Reads ──────────────────────────────────────────────────────────────

  findById(
    id: string | Types.ObjectId,
    projection?: ProjectionType<TDoc> | null,
    options?: QueryOptions<TDoc>,
  ): Promise<HydratedDocument<TDoc> | null> {
    return this.model.findById(id, projection ?? undefined, options).exec();
  }

  findOne(
    filter: FilterQuery<TDoc>,
    projection?: ProjectionType<TDoc> | null,
    options?: QueryOptions<TDoc>,
  ): Promise<HydratedDocument<TDoc> | null> {
    return this.model.findOne(filter, projection ?? undefined, options).exec();
  }

  exists(filter: FilterQuery<TDoc>): Promise<boolean> {
    return this.model.exists(filter).then((doc) => doc !== null);
  }

  count(filter: FilterQuery<TDoc> = {}): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  find(
    filter: FilterQuery<TDoc> = {},
    options?: QueryOptions<TDoc> & { populate?: PopulateOptions | PopulateOptions[] },
  ): Promise<HydratedDocument<TDoc>[]> {
    const query = this.model.find(filter, null, options);
    if (options?.populate) query.populate(options.populate);
    return query.exec();
  }

  async paginate(
    filter: FilterQuery<TDoc>,
    params: PaginationParams,
    options: {
      projection?: ProjectionType<TDoc> | null;
      populate?: PopulateOptions | PopulateOptions[];
      defaultSortBy?: keyof TDoc | string;
    } = {},
  ): Promise<Paginated<HydratedDocument<TDoc>>> {
    const { page, limit, sortBy, sortOrder } = params;
    const skip = (page - 1) * limit;
    const sortField = sortBy ?? (options.defaultSortBy as string) ?? 'createdAt';
    const sort: Record<string, 1 | -1> = { [sortField]: sortOrder === 'asc' ? 1 : -1 };

    const query = this.model
      .find(filter, options.projection ?? undefined)
      .sort(sort)
      .skip(skip)
      .limit(limit);
    if (options.populate) query.populate(options.populate);

    const [items, total] = await Promise.all([query.exec(), this.count(filter)]);
    return { items, meta: buildPaginationMeta(total, { page, limit }) };
  }

  aggregate<TResult = Record<string, unknown>>(pipeline: PipelineStage[]): Promise<TResult[]> {
    return this.model.aggregate<TResult>(pipeline).exec();
  }

  // ─── Writes ─────────────────────────────────────────────────────────────

  create(doc: Partial<TDoc>, session?: ClientSession): Promise<HydratedDocument<TDoc>> {
    return this.model.create([doc], { session, ordered: true }).then(([d]) => d);
  }

  createMany(docs: Partial<TDoc>[], session?: ClientSession): Promise<HydratedDocument<TDoc>[]> {
    return this.model.create(docs, { session, ordered: true });
  }

  updateById(
    id: string | Types.ObjectId,
    update: UpdateQuery<TDoc>,
    options: QueryOptions<TDoc> = { new: true },
  ): Promise<HydratedDocument<TDoc> | null> {
    return this.model.findByIdAndUpdate(id, update, { new: true, ...options }).exec();
  }

  updateOne(
    filter: FilterQuery<TDoc>,
    update: UpdateQuery<TDoc>,
    options: QueryOptions<TDoc> = { new: true },
  ): Promise<HydratedDocument<TDoc> | null> {
    return this.model.findOneAndUpdate(filter, update, { new: true, ...options }).exec();
  }

  upsert(
    filter: FilterQuery<TDoc>,
    update: UpdateQuery<TDoc>,
    options: QueryOptions<TDoc> = {},
  ): Promise<HydratedDocument<TDoc> | null> {
    return this.model
      .findOneAndUpdate(filter, update, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        ...options,
      })
      .exec();
  }

  deleteById(
    id: string | Types.ObjectId,
    options?: QueryOptions<TDoc>,
  ): Promise<HydratedDocument<TDoc> | null> {
    return this.model.findByIdAndDelete(id, options).exec();
  }

  deleteMany(
    filter: RootFilterQuery<TDoc>,
  ): Promise<{ acknowledged: boolean; deletedCount: number }> {
    return this.model.deleteMany(filter).exec();
  }
}
