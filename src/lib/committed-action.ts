/** A successful write stays successful even when the subsequent reconciliation is offline. */
export async function commitWithBackgroundRefresh<T>(
  commit: () => Promise<T>,
  refresh: () => Promise<unknown>,
  onRefreshError: (reason: unknown) => void = () => undefined,
): Promise<T> {
  const result = await commit()
  void Promise.resolve().then(refresh).catch(onRefreshError)
  return result
}
