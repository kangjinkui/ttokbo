export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMessagingWorker } = await import("./lib/messaging/worker");
  startMessagingWorker();
}
