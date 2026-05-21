import cron from 'node-cron';
import { getPendingPosts, markPublished, markFailed } from './db.js';
import { postLinkedinPost, postLinkedinPoll, postLinkedinGroupPost } from './linkedin.js';
import { postSubstackNote } from './substack.js';
import { log } from './logger.js';

const LINKEDIN_DELAY_MS = 60_000;
const SUBSTACK_DELAY_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processPost(post, dryRun) {
  const preview = post.content.slice(0, 80).replace(/\n/g, ' ');

  if (dryRun) {
    log.info(`[DRY-RUN] Would post id=${post.id} platform=${post.platform} scheduled=${post.scheduled_at} content="${preview}..."`);
    return { skipped: true };
  }

  log.info(`Processing id=${post.id} platform=${post.platform}`);

  let postId = null;

  switch (post.platform) {
    case 'linkedin_post':
      postId = await postLinkedinPost(post);
      break;
    case 'linkedin_poll':
      postId = await postLinkedinPoll(post);
      break;
    case 'linkedin_group':
      postId = await postLinkedinGroupPost(post);
      break;
    case 'substack_note':
      postId = await postSubstackNote(post);
      break;
    default:
      throw new Error(`Unknown platform: ${post.platform}`);
  }

  return { postId };
}

async function runCheck(dryRun) {
  log.info('Scheduler check running...');
  const pending = getPendingPosts(3);

  if (pending.length === 0) {
    log.info('No pending posts due right now.');
    return;
  }

  log.info(`Found ${pending.length} post(s) to process.`);

  let lastPlatform = null;
  let lastProcessedAt = null;

  for (const post of pending) {
    try {
      if (lastProcessedAt !== null) {
        const isLinkedin = post.platform.startsWith('linkedin');
        const wasLinkedin = lastPlatform && lastPlatform.startsWith('linkedin');
        const isSubstack = post.platform === 'substack_note';
        const wasSubstack = lastPlatform === 'substack_note';

        if (isLinkedin && wasLinkedin) {
          const elapsed = Date.now() - lastProcessedAt;
          const remaining = LINKEDIN_DELAY_MS - elapsed;
          if (remaining > 0) {
            log.info(`Rate-limit delay: waiting ${Math.ceil(remaining / 1000)}s between LinkedIn posts...`);
            await sleep(remaining);
          }
        } else if (isSubstack && wasSubstack) {
          const elapsed = Date.now() - lastProcessedAt;
          const remaining = SUBSTACK_DELAY_MS - elapsed;
          if (remaining > 0) {
            log.info(`Rate-limit delay: waiting ${Math.ceil(remaining / 1000)}s between Substack notes...`);
            await sleep(remaining);
          }
        }
      }

      const result = await processPost(post, dryRun);

      if (!result.skipped) {
        markPublished(post.id, result.postId ?? null);
        log.success(`id=${post.id} marked published.`);
      }

      lastPlatform = post.platform;
      lastProcessedAt = Date.now();
    } catch (err) {
      const message = err.message || String(err);
      log.error(`Failed id=${post.id} platform=${post.platform}: ${message}`);
      if (!dryRun) {
        markFailed(post.id, message);
      }
      lastPlatform = post.platform;
      lastProcessedAt = Date.now();
    }
  }
}

export function startScheduler(dryRun = false) {
  if (dryRun) {
    log.info('=== DRY-RUN MODE — no posts will actually be sent ===');
  }

  log.info('Scheduler starting. Checking every 5 minutes.');

  // Run immediately on startup
  runCheck(dryRun).catch((err) => log.error(`Startup check error: ${err.message}`));

  cron.schedule('*/5 * * * *', () => {
    runCheck(dryRun).catch((err) => log.error(`Cron check error: ${err.message}`));
  });
}
