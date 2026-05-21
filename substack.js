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
      Cookie: `substack.sid=${decodeURIComponent(sid)}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => '');
    log.info(`Substack auth failure (${res.status}): ${body.slice(0, 200)}`);
    throw new Error(
      `Substack ${res.status} — session likely expired. Log in at substack.com, copy a fresh substack.sid cookie, update SUBSTACK_SID in .env`
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
