import '../load-env.js';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

/**
 * Gets the OAuth2 refresh token for sending email through Gmail's SMTP (SMTP_OAUTH_REFRESH_TOKEN).
 * Run it once on your own computer, where a browser can reach this computer:
 *   npm run gmail-token
 * It reads SMTP_OAUTH_CLIENT_ID / SMTP_OAUTH_CLIENT_SECRET (and SMTP_USER as a login hint) from
 * .env, or takes --client-id / --client-secret. Open the printed link, sign in with the Gmail
 * account that sends the site's email notifications, allow access, and copy the printed token into .env.
 *
 * The Google Cloud OAuth client must be a "Desktop app", or a "Web application" with
 * http://127.0.0.1:53682/ as an authorised redirect URI (change the port with --port).
 * Put the OAuth consent screen "In production": while it is "Testing", Google expires the
 * refresh token after 7 days and email stops.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v !== undefined && !v.startsWith('--') ? v : undefined;
}

// SMTP needs the full Gmail scope; gmail.send only works with the Gmail API, not SMTP.
const SCOPE = 'https://mail.google.com/';

const clientId = arg('client-id') ?? process.env.SMTP_OAUTH_CLIENT_ID;
const clientSecret = arg('client-secret') ?? process.env.SMTP_OAUTH_CLIENT_SECRET;
const port = Number(arg('port') ?? 53682);
const user = process.env.SMTP_USER;

if (!clientId || !clientSecret) {
  console.error(`
Set SMTP_OAUTH_CLIENT_ID and SMTP_OAUTH_CLIENT_SECRET in .env first, or run:
  npm run gmail-token -- --client-id "....apps.googleusercontent.com" --client-secret "..."
`);
  process.exit(1);
}

const redirectUri = `http://127.0.0.1:${port}/`;
const state = randomBytes(16).toString('hex');
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: SCOPE,
  // A refresh token is only issued for offline access, and again only when consent is shown.
  access_type: 'offline',
  prompt: 'consent',
  state,
  ...(user ? { login_hint: user } : {}),
}).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirectUri);
  if (url.pathname !== '/') {
    res.writeHead(404).end();
    return;
  }
  const finish = (status: number, text: string) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(text);
    server.close();
  };
  if (url.searchParams.get('state') !== state) return finish(400, 'Unexpected request (state does not match). Run the command again.');
  const error = url.searchParams.get('error');
  if (error) {
    console.error(`\nGoogle refused: ${error}\n`);
    process.exitCode = 1;
    return finish(400, `Google refused: ${error}. You can close this tab.`);
  }
  const code = url.searchParams.get('code');
  if (!code) return finish(400, 'No code in the reply. Run the command again.');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  const token = (await tokenRes.json()) as { refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!tokenRes.ok || !token.refresh_token) {
    console.error(`\nCould not get a refresh token: ${token.error ?? tokenRes.status} ${token.error_description ?? ''}\n`);
    process.exitCode = 1;
    return finish(500, 'Could not get a refresh token - see the terminal. You can close this tab.');
  }
  if (!token.scope?.split(' ').includes(SCOPE)) {
    console.warn('\nWarning: access to Gmail was not granted (tick the Gmail permission on the consent screen); SMTP will refuse the token.\n');
  }
  console.log(`
Done. Put these in .env (locally) and in the hosting's .env (production):

  EMAIL_PROVIDER=smtp
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=465
  SMTP_SECURE=true
  SMTP_USER=${user ?? '<the Gmail address you just signed in with>'}
  SMTP_PASS=
  SMTP_OAUTH_CLIENT_ID=${clientId}
  SMTP_OAUTH_CLIENT_SECRET=<your client secret>
  SMTP_OAUTH_REFRESH_TOKEN=${token.refresh_token}
  EMAIL_FROM=Опасен чар <${user ?? 'the same Gmail address'}>

Keep the refresh token secret: it can send email as that account.
`);
  finish(200, 'Done - the refresh token is in the terminal. You can close this tab.');
});

server.on('error', (err) => {
  console.error(`\nCould not listen on ${redirectUri}: ${err.message}. Try another port with --port.\n`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`
Open this link in your browser and sign in with the Gmail account that sends the site's email notifications:

${authUrl.toString()}

Waiting for Google to send you back to ${redirectUri} ...
`);
});
