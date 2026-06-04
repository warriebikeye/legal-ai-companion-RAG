export async function withTimeout(
  promise,
  ms = 30000
) {
  let timeout;

  const timeoutPromise =
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(
          new Error(
            "Operation timeout"
          )
        );
      }, ms);
    });

  return Promise.race([
    promise,
    timeoutPromise,
  ]).finally(() => {
      clearTimeout(timeout);
    });
}