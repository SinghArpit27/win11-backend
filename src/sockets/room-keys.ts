/** Canonical Socket.io room keys — reused by handlers and gateway. */
export const SocketRoom = {
  user: (userId: string): string => `user:${userId}`,
  contest: (contestId: string): string => `contest:${contestId}`,
  match: (matchId: string): string => `match:${matchId}`,
} as const;

export type SocketRoomKey = ReturnType<(typeof SocketRoom)[keyof typeof SocketRoom]>;
