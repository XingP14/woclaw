/**
 * ForgettingScheduler — drives periodic memory eviction based on importance
 * decay, access patterns, and feedback signals.
 *
 * Runs via node-cron:
 *   - Daily cleanup: mark low-importance sessions for extraction
 *   - Weekly eviction: permanently remove lowest-ranked memories/sessions
 */

import cron from 'node-cron';
import type { ClawDB } from './db.js';
import type { SessionStore } from './session_store.js';
import type { ExtractionEngine } from './extraction/engine.js';
import { errorMessage } from './errors.js';
import { schedLog, schedWarn, schedError } from './scheduler_log.js';

export interface ForgettingConfig {
  /** Default importance floor — memories below this (before feedback) are eviction candidates */
  importanceFloor: number;
  /** Recency decay half-life in days */
  recencyHalfLifeDays: number;
  /** Minimum access count before considering eviction */
  minAccessCount: number;
  /** Max sessions to evict per weekly run */
  maxEvictionsPerRun: number;
  /** Whether to actually delete (false = dry-run) */
  enabled: boolean;
}

const DEFAULT_CONFIG: ForgettingConfig = {
  importanceFloor: 3.0,
  recencyHalfLifeDays: 30,
  minAccessCount: 2,
  maxEvictionsPerRun: 50,
  enabled: true,
};

export class ForgettingScheduler {
  private dailyJob: ReturnType<typeof cron.schedule> | null = null;
  private weeklyJob: ReturnType<typeof cron.schedule> | null = null;
  private config: ForgettingConfig;

  constructor(
    private db: ClawDB,
    private sessionStore: SessionStore,
    private extractionEngine: ExtractionEngine | null,
    config: Partial<ForgettingConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the cron jobs.
   * Call after Hub is initialized.
   */
  start(): void {
    if (!this.config.enabled) {
      schedLog('Disabled — not starting cron jobs');
      return;
    }

    // Daily: queue un-extracted high-importance sessions for AI extraction
    // Runs at 03:00 every day
    this.dailyJob = cron.schedule('0 3 * * *', async () => {
      schedLog('Running daily extraction queue scan…');
      await this.runDailyExtractionScan();
    }, {
      timezone: 'UTC',
    });

    // Weekly: evict lowest-ranked memories and sessions
    // Runs at 04:00 every Sunday
    this.weeklyJob = cron.schedule('0 4 * * 0', async () => {
      schedLog('Running weekly eviction…');
      await this.runWeeklyEviction();
    }, {
      timezone: 'UTC',
    });

    schedLog(
      `Started — daily at 03:00 UTC, weekly Sunday 04:00 UTC`
    );
    schedLog(`Config:`, this.config);
  }

  /**
   * Stop all scheduled jobs.
   */
  stop(): void {
    this.dailyJob?.stop();
    this.weeklyJob?.stop();
    this.dailyJob = null;
    this.weeklyJob = null;
    schedLog('Stopped');
  }

  // ─── Daily: queue sessions for extraction ──────────────────────────────────

  /**
   * Scan for sessions that:
   * 1. Have importance >= 6.0 (above eviction floor)
   * 2. Have NOT yet been extracted
   * 3. Are at least 7 days old
   *
   * Add them to the extraction queue with priority = importance.
   */
  private async runDailyExtractionScan(): Promise<void> {
    try {
      const allSessions = await this.db.getAllSessions(undefined, undefined, 200, 0);
      const now = Date.now();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      const toExtract = allSessions.filter(
        (s) =>
          !s.extracted &&
          s.importance >= 6.0 &&
          (s.endedAt ?? s.startedAt) < now - SEVEN_DAYS,
      );

      for (const session of toExtract) {
        await this.db.addToExtractionQueue(session.id, Math.round(session.importance));
        schedLog(`Queued session ${session.id} (importance=${session.importance})`);
      }

      schedLog(`Daily scan complete — queued ${toExtract.length} sessions`);
    } catch (err: unknown) {
      schedError('Daily scan error:', errorMessage(err));
    }
  }

  // ─── Weekly: evict lowest-ranked items ────────────────────────────────────

  /**
   * Weekly eviction:
   * 1. Call db.getEvictionCandidates() to find low-priority memories + sessions
   * 2. For sessions: delete directly
   * 3. For memories: delete directly (memory pool handles expiry separately)
   */
  async runWeeklyEviction(): Promise<{ sessions: number; memories: number }> {
    try {
      const candidates = await this.db.getEvictionCandidates(
        this.config.importanceFloor,
        this.config.importanceFloor,
        this.config.maxEvictionsPerRun,
      );

      let sessionsDeleted = 0;
      let memoriesDeleted = 0;

      // Defensively cap to maxEvictionsPerRun to handle DB implementations
      // that return more than the requested limit
      const sessionsToEvict = candidates.sessions.slice(0, this.config.maxEvictionsPerRun);
      const memoriesToEvict = candidates.memories.slice(0, this.config.maxEvictionsPerRun);

      // Evict low-priority sessions
      for (const s of sessionsToEvict) {
        try {
          const ok = await this.sessionStore.deleteSession(s.id);
          if (ok) {
            sessionsDeleted++;
            schedLog(`Evicted session ${s.id} (importance=${s.importance.toFixed(2)})`);
          }
        } catch (err: unknown) {
          schedWarn(`Failed to evict session ${s.id}:`, errorMessage(err));
        }
      }

      // Evict low-priority memories
      for (const m of memoriesToEvict) {
        try {
          const ok = await this.db.deleteMemory(m.key);
          if (ok) {
            memoriesDeleted++;
            schedLog(`Evicted memory "${m.key}" (importance=${m.importance.toFixed(2)})`);
          }
        } catch (err: unknown) {
          schedWarn(`Failed to evict memory "${m.key}":`, errorMessage(err));
        }
      }

      schedLog(
        `Weekly eviction complete — sessions=${sessionsDeleted}, memories=${memoriesDeleted}`
      );

      return { sessions: sessionsDeleted, memories: memoriesDeleted };
    } catch (err: unknown) {
      schedError('Weekly eviction error:', errorMessage(err));
      return { sessions: 0, memories: 0 };
    }
  }

  /**
   * Manually trigger eviction. Returns eviction results.
   */
  async triggerEviction(): Promise<{ sessions: number; memories: number }> {
    return this.runWeeklyEviction();
  }

  /**
   * Get current scheduler status.
   */
  getStatus(): {
    running: boolean;
    config: ForgettingConfig;
    nextDaily: string | null;
    nextWeekly: string | null;
  } {
    return {
      running: this.dailyJob !== null || this.weeklyJob !== null,
      config: this.config,
      // node-cron CronJob does not expose nextDate(); these are informational
      nextDaily: this.dailyJob !== null ? '<scheduled>' : null,
      nextWeekly: this.weeklyJob !== null ? '<scheduled>' : null,
    };
  }
}
