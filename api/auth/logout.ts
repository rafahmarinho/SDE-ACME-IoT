import { createRoute, readJsonBody } from '../_lib/security';

// SDE T1539: called by the web client on logout so the browser clears cached files, cookies and
// local/session storage for this origin. Requiring a JSON body forces a CORS preflight for
// cross-site callers, and createRoute rejects state-changing calls from untrusted origins.
export default createRoute({
  name: 'auth-logout',
  cors: true,
  rateLimit: { max: 30, windowMs: 60000 },
  methods: {
    POST: {
      auth: 'public',
      handler: async ({ req, res }) => {
        await readJsonBody(req);
        res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
        res.statusCode = 204;
        res.end();
      },
    },
  },
});
