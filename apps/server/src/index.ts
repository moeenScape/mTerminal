import { Pool } from 'pg';
import nodemailer from 'nodemailer';
import { createAccounts } from './accounts.ts';
import { migrateAccounts } from './database.ts';
import { createAccountServer } from './http.ts';

async function start(): Promise<void> {
  const {
    DATABASE_URL,
    MTERMINAL_SMTP_URL,
    MTERMINAL_SMTP_FROM,
    MTERMINAL_ACCOUNT_MFA_KEY,
    MTERMINAL_TRUST_ACCOUNT_PROXY,
    PORT = '8787',
  } = process.env;
  const port = Number(PORT);
  if (
    !DATABASE_URL ||
    !MTERMINAL_SMTP_URL ||
    !MTERMINAL_SMTP_FROM ||
    !MTERMINAL_ACCOUNT_MFA_KEY ||
    !/^[a-f0-9]{64}$/i.test(MTERMINAL_ACCOUNT_MFA_KEY) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    console.error(
      'Configure DATABASE_URL, MTERMINAL_SMTP_URL, MTERMINAL_SMTP_FROM, MTERMINAL_ACCOUNT_MFA_KEY and a valid PORT.',
    );
    process.exitCode = 1;
    return;
  }
  const smtp = new URL(MTERMINAL_SMTP_URL);
  if (
    !['smtp:', 'smtps:'].includes(smtp.protocol) ||
    smtp.search ||
    smtp.hash ||
    (smtp.pathname && smtp.pathname !== '/')
  )
    throw new Error('Invalid SMTP URL');
  const mailer = nodemailer.createTransport({
    host: smtp.hostname,
    port: smtp.port ? Number(smtp.port) : smtp.protocol === 'smtps:' ? 465 : 587,
    secure: smtp.protocol === 'smtps:',
    requireTLS: !['localhost', '127.0.0.1'].includes(smtp.hostname),
    ...(smtp.username
      ? {
          auth: {
            user: decodeURIComponent(smtp.username),
            pass: decodeURIComponent(smtp.password),
          },
        }
      : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });
  const pool = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
  });
  pool.on('error', () => console.error('An idle account database connection failed.'));
  try {
    await migrateAccounts(pool);
    const server = createAccountServer(
      createAccounts(
        pool,
        async (email, code, purpose) => {
          const verify = purpose === 'verify';
          await mailer.sendMail({
            from: MTERMINAL_SMTP_FROM,
            to: [{ name: '', address: email }],
            subject: verify ? 'Verify your mTerminal email' : 'Reset your mTerminal password',
            text: `Enter this code in mTerminal to ${verify ? 'create your account' : 'reset your password'}:\n\n${code}\n\nIt expires in 20 minutes. If you did not request it, you can ignore this email.`,
          });
        },
        Buffer.from(MTERMINAL_ACCOUNT_MFA_KEY, 'hex'),
      ),
      MTERMINAL_TRUST_ACCOUNT_PROXY === '1',
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    console.log(`mTerminal account service listening on 127.0.0.1:${port}`);
    const stop = () => server.close(() => void pool.end());
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch (error) {
    await pool.end();
    throw error;
  }
}

void start().catch(() => {
  console.error(
    'Account service startup failed. Check database access, SMTP configuration, and the listen port.',
  );
  process.exitCode = 1;
});
