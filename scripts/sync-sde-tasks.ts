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

const API_KEY = '3f01144acd87fd7d927c08a0e5b99a77af5c5ead';
const HOSTNAME = 'sde-ent-echo.sdelab.net';

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
        hostname: HOSTNAME,
        port: 443,
        path,
        method,
        headers: {
          Authorization: `Token ${API_KEY}`,
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
