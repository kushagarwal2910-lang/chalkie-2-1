/** A new navigation or generation invalidates every older asynchronous restore. */
export class SourceSessionGuard {
  private revision = 0;
  restoring = true;
  begin(restoring: boolean): number { this.restoring = restoring; return ++this.revision; }
  isCurrent(revision: number): boolean { return revision === this.revision; }
  finish(revision: number): boolean {
    if (!this.isCurrent(revision)) return false;
    this.restoring = false;
    return true;
  }
}
