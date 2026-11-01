import { createRoute, logSecurityEvent, readJsonBody } from './_lib/security';

const REPORT_CONTENT_TYPES = ['application/csp-report', 'application/reports+json', 'application/json'];
const MAX_REPORT_BYTES = 8 * 1024;

function originOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!/^https?:/i.test(value)) return value.slice(0, 32); // keywords such as 'inline' or 'eval'
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

// SDE T331: target of the Content-Security-Policy report-uri/report-to directives. Violations are
// logged (directive and origins only, never full URLs or query strings) for monitoring.
export default createRoute({
  name: 'csp-report',
  // Browsers send reports without CORS; the endpoint only logs, so the origin check is not needed.
  originCheck: false,
  rateLimit: { max: 30, windowMs: 60000 },
  methods: {
    POST: {
      auth: 'public',
      handler: async ({ req, res, clientIp }) => {
        const body: any = await readJsonBody(req, MAX_REPORT_BYTES, REPORT_CONTENT_TYPES);
        const reports: any[] = Array.isArray(body) ? body.map((r) => r?.body ?? r) : [body?.['csp-report'] ?? body];
        reports.slice(0, 10).forEach((report) => {
          const directive = report?.['effective-directive'] ?? report?.effectiveDirective ?? report?.['violated-directive'];
          logSecurityEvent('csp_violation', {
            route: 'csp-report',
            method: 'POST',
            ip: clientIp,
            status: 204,
            reason: JSON.stringify({
              directive: typeof directive === 'string' ? directive.slice(0, 64) : undefined,
              blocked: originOf(report?.['blocked-uri'] ?? report?.blockedURL),
              document: originOf(report?.['document-uri'] ?? report?.documentURL),
            }),
          });
        });
        res.statusCode = 204;
        res.end();
      },
    },
  },
});
