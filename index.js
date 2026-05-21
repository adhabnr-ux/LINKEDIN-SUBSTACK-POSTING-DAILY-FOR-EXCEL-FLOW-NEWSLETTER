import 'dotenv/config';
import { startScheduler } from './scheduler.js';
import { log } from './logger.js';

const dryRun = process.argv.includes('--dry-run');

const required = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN', 'SUBSTACK_SID'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  log.error(`Missing required environment variables: ${missing.join(', ')}`);
  log.error('Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}

log.info('Excel Flow Social Media Scheduler starting...');
log.info(`Person URN: ${process.env.LINKEDIN_PERSON_URN}`);

startScheduler(dryRun);
