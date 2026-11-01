import https from 'https';
import fs from 'fs';

interface TaskAssessment {
  countermeasure_id: string;
  task_id: string;
  title: string;
  priority: number;
  status: 'Complete' | 'Not Applicable' | 'Incomplete';
  note: string;
}

const assessments: TaskAssessment[] = JSON.parse(
  fs.readFileSync('docs/security/sde-controls-assessment.json', 'utf8')
);

// SDE T76/T248: the SD Elements endpoint and API token come from the environment
// (shell, CI secret store or a local .env file that is git-ignored). Never hardcode them.
interface SdeConfig {
  hostname: string;
  port: number;
  apiToken: string;
}

function loadSdeConfig(env: NodeJS.ProcessEnv = process.env): SdeConfig {
  const rawUrl = (env.SDE_URL || '').trim();
  const apiToken = (env.SDE_API_TOKEN || '').trim();
  const missing = [rawUrl ? '' : 'SDE_URL', apiToken ? '' : 'SDE_API_TOKEN'].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Export them in your shell or CI secret store before running this script (never commit credentials).'
    );
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('SDE_URL must be a valid URL, for example https://sde.example.com');
  }
  if (url.protocol !== 'https:') {
    throw new Error('SDE_URL must use https:// so the API token is never sent in clear text.');
  }
  return { hostname: url.hostname, port: url.port ? Number(url.port) : 443, apiToken };
}

let SDE_CONFIG: SdeConfig;
try {
  SDE_CONFIG = loadSdeConfig();
} catch (err: any) {
  console.error(`[sync-sde-tasks] ${err.message}`);
  process.exit(1);
}

const STATUS_MAP = {
  Complete: 'TS1',
  Incomplete: 'TS2',
  'Not Applicable': 'TS3',
};

function apiRequest(path: string, method: string, data?: any): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : undefined;
    const req = https.request(
      {
        hostname: SDE_CONFIG.hostname,
        port: SDE_CONFIG.port,
        path,
        method,
        headers: {
          Authorization: `Token ${SDE_CONFIG.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 500, body }));
      }
    );

    req.on('error', (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Starting sync for ${assessments.length} countermeasures to SD Elements Project 28...`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < assessments.length; i++) {
    const task = assessments[i];
    const statusId = STATUS_MAP[task.status];
    const taskPath = `/api/v2/projects/28/tasks/${task.countermeasure_id}/`;
    const notesPath = `/api/v2/projects/28/tasks/${task.countermeasure_id}/notes/`;

    try {
      // 1. Update status
      const statusRes = await apiRequest(taskPath, 'PATCH', { status: statusId });
      if (statusRes.status !== 200) {
        console.warn(`[${i + 1}/${assessments.length}] Status update warning for ${task.countermeasure_id}: ${statusRes.status}`);
      }

      // 2. Add bilingual comment ending with required signature
      const noteRes = await apiRequest(notesPath, 'POST', { text: task.note });
      if (noteRes.status === 201 || noteRes.status === 200) {
        successCount++;
        if ((i + 1) % 10 === 0 || i === assessments.length - 1) {
          console.log(`[${i + 1}/${assessments.length}] Successfully processed ${task.countermeasure_id} (${task.status})`);
        }
      } else {
        console.error(`[${i + 1}/${assessments.length}] Error posting note for ${task.countermeasure_id}: ${noteRes.status}`);
        errorCount++;
      }

      // Polite delay between requests
      await sleep(100);
    } catch (err: any) {
      console.error(`Failed on ${task.countermeasure_id}:`, err.message);
      errorCount++;
    }
  }

  console.log(`\nSD Elements Sync Complete! Successfully updated: ${successCount}, Errors: ${errorCount}`);
}

main().catch(console.error);
