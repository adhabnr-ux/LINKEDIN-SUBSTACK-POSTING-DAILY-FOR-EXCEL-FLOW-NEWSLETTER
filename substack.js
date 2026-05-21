import nodemailer from 'nodemailer';
import { log } from './logger.js';

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

export async function postSubstackNote(post) {
  const subject = post.content.slice(0, 100).trim();
  const body = post.content;

  log.info(`Posting substack_note id=${post.id} subject="${subject}"`);

  const transporter = createTransport();

  const info = await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.SUBSTACK_POST_EMAIL,
    subject,
    text: body,
  });

  log.success(`substack_note sent id=${post.id} messageId=${info.messageId}`);
  return info.messageId;
}
