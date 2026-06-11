addEventListener('popstate', () => location.reload())

customElements.define('log-scroll', class extends HTMLElement {
  connectedCallback() {
    this.atBottom = true
    this.addEventListener('scroll', (e) => {
      const el = e.target
      this.atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
    }, true)
    this.observer = new MutationObserver(() => this.follow())
    this.observer.observe(this, { subtree: true, childList: true, characterData: true })
    this.follow()
  }
  disconnectedCallback() {
    this.observer.disconnect()
  }
  follow() {
    const el = this.querySelector('pre')
    if (el && this.atBottom) el.scrollTop = el.scrollHeight
  }
})
