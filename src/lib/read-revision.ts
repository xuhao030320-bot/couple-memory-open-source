interface ReadToken { request: number; revision: number }

/** Shared by full-workspace reads and message-only reads, without cancelling other workspace fields. */
export class FreshReadGate {
  private request = 0
  private revision = 0
  begin(): ReadToken { return { request: ++this.request, revision: this.revision } }
  changed() { this.revision += 1 }
  accepts(token: ReadToken) { return token.request === this.request && token.revision === this.revision }
}
