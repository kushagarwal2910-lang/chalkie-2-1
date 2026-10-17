/** A consumed new-topic URL must never fall through to saved-notebook restoration. */
export class LessonEntryGuard {
  private launch: string | null = null;
  private restoreClaimed = false;

  claimLaunch(question: string, launchId?: string | null): boolean {
    this.restoreClaimed = true;
    const identity = JSON.stringify([question, launchId ?? ""]);
    if (this.launch === identity) return false;
    this.launch = identity;
    return true;
  }

  claimRestore(): boolean {
    if (this.restoreClaimed) return false;
    this.restoreClaimed = true;
    return true;
  }

  retryRestore() {
    if (this.launch === null) this.restoreClaimed = false;
  }
}
