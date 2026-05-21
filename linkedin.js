import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { log } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'https://api.linkedin.com/v2';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGroupUrn(groupName) {
  try {
    const groups = JSON.parse(
      readFileSync(join(__dirname, 'groups.json'), 'utf8')
    );
    const urn = groups[groupName];
    if (!urn) throw new Error(`Group "${groupName}" not found in groups.json`);
    return urn;
  } catch (err) {
    throw new Error(`Could not load groups.json: ${err.message}`);
  }
}

async function handleResponse(res, context) {
  if (res.status === 401) {
    throw new Error(
      'LinkedIn token expired — generate a new one at developer.linkedin.com and update LINKEDIN_ACCESS_TOKEN in .env'
    );
  }
  if (res.status === 429) {
    throw new Error('LinkedIn rate limit hit — too many requests. Wait before retrying.');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn API error (${res.status}) at ${context}: ${body}`);
  }
  return res;
}

function buildPostBody(content, authorUrn, visibility = 'PUBLIC', containerEntity = null) {
  const body = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: content },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': visibility,
    },
  };

  if (containerEntity) {
    body.containerEntity = containerEntity;
  }

  return body;
}

function buildPollBody(content, authorUrn, pollOptions) {
  const options = JSON.parse(pollOptions);
  if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
    throw new Error('poll_options must be a JSON array of 2–4 strings');
  }

  return {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: content },
        shareMediaCategory: 'NONE',
        pollContent: {
          question: content.slice(0, 255),
          options: options.map((text) => ({ text })),
          settings: {
            duration: 'SEVEN_DAYS',
          },
        },
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };
}

async function postComment(postUrn, commentText) {
  const authorUrn = process.env.LINKEDIN_PERSON_URN;
  const encodedUrn = encodeURIComponent(postUrn);
  const url = `${BASE_URL}/socialActions/${encodedUrn}/comments`;

  const body = {
    actor: authorUrn,
    message: { text: commentText },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  await handleResponse(res, 'postComment');
  log.success(`Comment posted on ${postUrn}`);
}

export async function postLinkedinPost(post) {
  const authorUrn = process.env.LINKEDIN_PERSON_URN;
  const body = buildPostBody(post.content, authorUrn);

  log.info(`Posting linkedin_post id=${post.id}`);

  const res = await fetch(`${BASE_URL}/ugcPosts`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  await handleResponse(res, 'ugcPosts');

  const postId = res.headers.get('x-restli-id') || res.headers.get('X-RestLi-Id');
  if (!postId) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`No post ID returned from LinkedIn. Response: ${JSON.stringify(data)}`);
  }

  log.success(`linkedin_post published id=${post.id} postId=${postId}`);

  if (post.first_comment) {
    log.info('Waiting 30s before posting first comment...');
    await sleep(30000);
    await postComment(postId, post.first_comment);
  }

  return postId;
}

export async function postLinkedinPoll(post) {
  const authorUrn = process.env.LINKEDIN_PERSON_URN;
  const body = buildPollBody(post.content, authorUrn, post.poll_options);

  log.info(`Posting linkedin_poll id=${post.id}`);

  const res = await fetch(`${BASE_URL}/ugcPosts`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  await handleResponse(res, 'ugcPosts (poll)');

  const postId = res.headers.get('x-restli-id') || res.headers.get('X-RestLi-Id');
  if (!postId) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`No post ID returned from LinkedIn poll. Response: ${JSON.stringify(data)}`);
  }

  log.success(`linkedin_poll published id=${post.id} postId=${postId}`);

  if (post.first_comment) {
    log.info('Waiting 30s before posting first comment...');
    await sleep(30000);
    await postComment(postId, post.first_comment);
  }

  return postId;
}

export async function postLinkedinGroupPost(post) {
  const authorUrn = process.env.LINKEDIN_PERSON_URN;
  const groupUrn = getGroupUrn(post.group_name);
  const body = buildPostBody(post.content, authorUrn, 'PUBLIC', groupUrn);

  log.info(`Posting linkedin_group post id=${post.id} group=${post.group_name}`);

  const res = await fetch(`${BASE_URL}/ugcPosts`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  await handleResponse(res, 'ugcPosts (group)');

  const postId = res.headers.get('x-restli-id') || res.headers.get('X-RestLi-Id');
  if (!postId) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`No post ID returned from LinkedIn group post. Response: ${JSON.stringify(data)}`);
  }

  log.success(`linkedin_group published id=${post.id} postId=${postId} group=${post.group_name}`);

  if (post.first_comment) {
    log.info('Waiting 30s before posting first comment...');
    await sleep(30000);
    await postComment(postId, post.first_comment);
  }

  return postId;
}
