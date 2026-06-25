import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { QueueName } from '@common/enums';

import { registerWorker } from '@queues/queue.factory';
import type { DepositSettlementJob } from '@modules/financial-settlement/settlement.service';
import { financialSettlementService } from '@modules/financial-settlement/settlement.service';
import type { WithdrawalSettlementJob } from '@modules/withdrawals/withdrawal.service';
import { withdrawalService } from '@modules/withdrawals/withdrawal.service';

export const initFinancialSettlementJobs = (): void => {
  if (!isRedisEnabled()) {
    logger.info({ event: 'financial.jobs.skipped' }, 'Redis disabled — settlement workers not registered');
    return;
  }

  registerWorker<DepositSettlementJob>(
    QueueName.DEPOSIT_SETTLEMENT,
    async (job) => {
      await financialSettlementService.processDepositSettlement(job.data.settlementId, job.data.paymentId);
    },
    { concurrency: 5 },
  );

  registerWorker<WithdrawalSettlementJob>(
    QueueName.WITHDRAWAL_SETTLEMENT,
    async (job) => {
      await withdrawalService.processSettlement(job.data.settlementId, job.data.withdrawalId);
    },
    { concurrency: 3 },
  );

  logger.info({ event: 'financial.jobs.ready' }, 'Financial settlement workers registered');
};
