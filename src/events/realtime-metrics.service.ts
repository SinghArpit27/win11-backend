/**
 * In-process counters for admin realtime monitoring.
 * Reset on process restart — suitable for ops dashboards, not billing.
 */
class RealtimeMetricsService {
  private published = 0;
  private delivered = 0;
  private failed = 0;
  private socketConnections = 0;
  private activeRooms = new Set<string>();

  recordPublished(count = 1): void {
    this.published += count;
  }

  recordDelivered(count = 1): void {
    this.delivered += count;
  }

  recordFailed(count = 1): void {
    this.failed += count;
  }

  setSocketConnections(count: number): void {
    this.socketConnections = count;
  }

  trackRoom(room: string): void {
    this.activeRooms.add(room);
  }

  untrackRoom(room: string): void {
    this.activeRooms.delete(room);
  }

  snapshot() {
    return {
      published: this.published,
      delivered: this.delivered,
      failed: this.failed,
      socketConnections: this.socketConnections,
      activeRooms: this.activeRooms.size,
      throughputPerMinute: this.delivered,
    };
  }
}

export const realtimeMetrics = new RealtimeMetricsService();
