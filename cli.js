#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import { createInterface } from 'readline';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { insertPost, insertPosts, getAllPosts, getPostById, updateStatus } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = join(__dirname, 'logs', 'activity.log');

const MST_OFFSET_HOURS = -7; // MST = UTC-7

function mstToUtc(mstDateStr) {
  // Expects "YYYY-MM-DD HH:MM" in MST, returns ISO UTC string
  const localDate = new Date(mstDateStr + ':00.000Z');
  // Shift: subtract the MST offset (which is -7), so add 7 hours
  const utcMs = localDate.getTime() - MST_OFFSET_HOURS * 60 * 60 * 1000;
  return new Date(utcMs).toISOString().replace('T', ' ').slice(0, 19);
}

function utcToMst(utcStr) {
  const d = new Date(utcStr.includes('T') ? utcStr : utcStr + 'Z');
  const mstMs = d.getTime() + MST_OFFSET_HOURS * 60 * 60 * 1000;
  return new Date(mstMs).toISOString().replace('T', ' ').slice(0, 16);
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

function printTable(posts) {
  if (posts.length === 0) {
    console.log('No posts found.');
    return;
  }
  const header = ['ID', 'Scheduled (MST)', 'Platform', 'Content (60 chars)', 'Status'];
  const rows = posts.map((p) => [
    String(p.id),
    utcToMst(p.scheduled_at),
    p.platform,
    truncate(p.content.replace(/\n/g, ' '), 60),
    p.status,
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );

  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  const fmt = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join(' | ');

  console.log(fmt(header));
  console.log(sep);
  rows.forEach((r) => console.log(fmt(r)));
}

// --- add-post ---
program
  .command('add-post')
  .description('Interactively add a single post to the queue')
  .action(async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const platforms = ['linkedin_post', 'linkedin_poll', 'linkedin_group', 'substack_note'];
    console.log('Platforms: ' + platforms.join(', '));

    const platform = await ask(rl, 'Platform: ');
    if (!platforms.includes(platform)) {
      console.error(`Invalid platform. Choose from: ${platforms.join(', ')}`);
      rl.close();
      process.exit(1);
    }

    const scheduledMst = await ask(rl, 'Scheduled date/time MST (YYYY-MM-DD HH:MM): ');
    const scheduled_at = mstToUtc(scheduledMst);

    console.log('Content (type END on a new line to finish):');
    let content = '';
    for await (const line of rl[Symbol.asyncIterator]()) {
      if (line.trim() === 'END') break;
      content += (content ? '\n' : '') + line;
    }

    let first_comment = null;
    let poll_options = null;
    let group_name = null;

    if (platform === 'linkedin_post' || platform === 'linkedin_group') {
      first_comment = await ask(rl, 'First comment (leave blank to skip): ');
      if (!first_comment.trim()) first_comment = null;
    }

    if (platform === 'linkedin_poll') {
      first_comment = await ask(rl, 'First comment / Substack link (leave blank to skip): ');
      if (!first_comment.trim()) first_comment = null;
      const opts = [];
      for (let i = 1; i <= 4; i++) {
        const opt = await ask(rl, `Poll option ${i} (leave blank to stop): `);
        if (!opt.trim()) break;
        opts.push(opt.trim());
      }
      if (opts.length < 2) {
        console.error('Polls require at least 2 options.');
        rl.close();
        process.exit(1);
      }
      poll_options = JSON.stringify(opts);
    }

    if (platform === 'linkedin_group') {
      group_name = await ask(rl, 'Group name (must match key in groups.json): ');
    }

    rl.close();

    const result = insertPost({ scheduled_at, platform, content, first_comment, poll_options, group_name });
    console.log(`\nPost added! ID: ${result.lastInsertRowid}`);
    console.log(`Scheduled UTC: ${scheduled_at}  (MST: ${scheduledMst})`);
  });

// --- import-json ---
program
  .command('import-json <filepath>')
  .description('Bulk import posts from a JSON file')
  .action((filepath) => {
    const fullPath = resolve(filepath);
    if (!existsSync(fullPath)) {
      console.error(`File not found: ${fullPath}`);
      process.exit(1);
    }

    let data;
    try {
      data = JSON.parse(readFileSync(fullPath, 'utf8'));
    } catch (err) {
      console.error(`Failed to parse JSON: ${err.message}`);
      process.exit(1);
    }

    if (!Array.isArray(data)) {
      console.error('JSON file must contain an array of post objects.');
      process.exit(1);
    }

    const posts = data.map((item, i) => {
      if (!item.scheduled_at_mst) throw new Error(`Post at index ${i} missing scheduled_at_mst`);
      if (!item.platform) throw new Error(`Post at index ${i} missing platform`);
      if (!item.content) throw new Error(`Post at index ${i} missing content`);
      return {
        scheduled_at: mstToUtc(item.scheduled_at_mst),
        platform: item.platform,
        content: item.content,
        first_comment: item.first_comment ?? null,
        poll_options: item.poll_options ? JSON.stringify(item.poll_options) : null,
        group_name: item.group_name ?? null,
      };
    });

    insertPosts(posts);
    console.log(`Imported ${posts.length} post(s) successfully.`);
    posts.forEach((p, i) => {
      console.log(`  [${i + 1}] ${p.platform} → ${utcToMst(p.scheduled_at)} MST`);
    });
  });

// --- list ---
program
  .command('list')
  .description('List all pending posts')
  .option('--all', 'Show all posts regardless of status')
  .action((opts) => {
    const posts = opts.all ? getAllPosts() : getAllPosts('pending');
    printTable(posts);
  });

// --- cancel ---
program
  .command('cancel <id>')
  .description("Set a post's status to 'cancelled'")
  .action((id) => {
    const post = getPostById(Number(id));
    if (!post) {
      console.error(`No post found with id=${id}`);
      process.exit(1);
    }
    updateStatus(Number(id), 'cancelled');
    console.log(`Post id=${id} cancelled.`);
  });

// --- retry ---
program
  .command('retry <id>')
  .description("Reset a failed post's status back to 'pending'")
  .action((id) => {
    const post = getPostById(Number(id));
    if (!post) {
      console.error(`No post found with id=${id}`);
      process.exit(1);
    }
    if (post.status !== 'failed' && post.status !== 'cancelled') {
      console.error(`Post id=${id} has status '${post.status}', not 'failed' or 'cancelled'.`);
      process.exit(1);
    }
    updateStatus(Number(id), 'pending');
    console.log(`Post id=${id} reset to pending.`);
  });

// --- logs ---
program
  .command('logs')
  .description('Show last 50 lines of activity.log')
  .action(() => {
    if (!existsSync(LOG_FILE)) {
      console.log('No activity.log file found yet. Start the scheduler first.');
      return;
    }
    const content = readFileSync(LOG_FILE, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const last50 = lines.slice(-50);
    console.log(last50.join('\n'));
  });

program.parse(process.argv);
