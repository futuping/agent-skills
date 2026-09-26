import { receiveOnce } from './channel.mjs';
import { prepareBackground, removePasskeyGuard } from './background.mjs';
import { runPlan } from './engine.mjs';
import { safeFailure } from './core.mjs';

export async function runFromSocket(channel, { taskSpace }) {
  let credential, page, guard, result;
  try {
    const payload = await receiveOnce(channel);
    credential = payload.credential;
    const task = await taskSpace(payload.plan.spaceId);
    page = task.page(payload.plan.pageLabel);
    guard = await prepareBackground(task, page, payload.plan.guardIdentifier);
    result = await runPlan(page, payload.plan, credential);
  } catch (error) { result = safeFailure(error); }
  finally {
    if (guard) {
      try { await removePasskeyGuard(page, guard); }
      catch { result = { ok: false, status: 'cleanup_required', loginStatus: result?.status || 'execution_failed' }; }
    }
    if (credential) for (const key of Object.keys(credential)) credential[key] = '';
  }
  console.log(`BWLOGIN_RESULT ${JSON.stringify(result)}`);
}
