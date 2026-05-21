import fetch from 'node-fetch';
import { log } from './logger.js';

// Substack has no official publishing API. This uses the internal endpoint
// that the Substack web app itself calls when you publish a Note.
const NOTES_ENDPOINT = 'https://substack.com/api/v1/comment/feed';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// Substack stores note content as a ProseMirror "doc". Each line of text
// becomes its own paragraph; blank lines are kept as a space so spacing
// in the original content is preserved (empty paragraphs are rejected).
function buildBodyJson(content) {
  const lines = content.trim().split('\n');
  const paragraphs = lines.map((line) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: line.length > 0 ? line : ' ' }],
  }));

  return {
    type: 'doc',
    attrs: { schemaVersion: 'v1' },
    content: paragraphs,
  };
}

function buildCookieHeader(sid) {
  const parts = [`substack.sid=${decodeURIComponent(sid)}`];
  if (process.env.CF_CLEARANCE) {
    parts.push(`cf_clearance=${process.env.CF_CLEARANCE}`);
  }
  return parts.join('; ');
}

export async function postSubstackNote(post) {
  const sid = process.env.SUBSTACK_SID;
  if (!sid) {
    throw new Error('SUBSTACK_SID is not set in .env');
  }

  log.info(`Posting substack_note id=${post.id} via Substack internal API`);

  const body = {
    bodyJson: buildBodyJson(post.content),
    tabId: 'for-you',
    surface: 'feed',
    replyMinimumRole: 'everyone',
  };

  const res = await fetch(NOTES_ENDPOINT, {
    method: 'POST',
    headers: {
      Cookie: buildCookieHeader(sid),
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Origin: 'https://substack.com',
      Referer: 'https://substack.com/',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    const errBody = await res.text().catch(() => '');
    log.info(`Substack auth failure (${res.status}): ${errBody.slice(0, 200)}`);
    throw new Error(
      `Substack ${res.status} — check that SUBSTACK_SID and CF_CLEARANCE in .env are fresh (copy both from DevTools → Application → Cookies → https://substack.com)`
    );
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Substack API error (${res.status}): ${errText}`);
  }

  const data = await res.json().catch(() => ({}));
  const noteId = data.id != null ? String(data.id) : null;

  log.success(`substack_note published id=${post.id} noteId=${noteId}`);
  return noteId;
}
