// <details> 收折動畫：高度平滑展開／收起，內容淡入淡出；減少動態時改回瞬間切換
const DURATION = 280;
const EASING = 'cubic-bezier(.25, .8, .25, 1)';

/** 讓 <details> 開關時有動畫。以事件委派綁在 details 上，內容被重繪（innerHTML）也不受影響 */
export function animateDetails(d: HTMLDetailsElement, reduced: () => boolean) {
  let anim: Animation | null = null;
  let fades: Animation[] = [];
  let closing = false;
  d.classList.toggle('is-open', d.open);

  const summaryOf = () => d.querySelector<HTMLElement>(':scope > summary');
  const content = () => [...d.children].filter(c => c.tagName !== 'SUMMARY') as HTMLElement[];
  const closedHeight = () => {
    const cs = getComputedStyle(d);
    return (summaryOf()?.offsetHeight ?? 0) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  };
  const stop = () => {
    anim?.cancel();
    fades.forEach(f => f.cancel());
    anim = null;
    fades = [];
  };
  const finish = (open: boolean) => {
    d.open = open;
    stop();
    d.style.overflow = '';
    closing = false;
  };

  d.addEventListener('click', ev => {
    const s = summaryOf();
    if (!s || !(ev.target instanceof Node) || !s.contains(ev.target)) return;
    if (reduced()) { d.classList.toggle('is-open', !d.open); return; } // 交給瀏覽器預設行為
    ev.preventDefault();

    const from = d.offsetHeight;
    stop();
    d.style.overflow = 'hidden';
    const opening = !d.open || closing;
    d.classList.toggle('is-open', opening);
    const opts = { duration: DURATION, easing: EASING };

    if (opening) {
      closing = false;
      d.open = true;
      const to = d.offsetHeight;
      anim = d.animate({ height: [`${from}px`, `${to}px`] }, opts);
      fades = content().map(c => c.animate({ opacity: [0, 1], transform: ['translateY(-6px)', 'none'] }, opts));
      anim.onfinish = () => finish(true);
    } else {
      closing = true;
      anim = d.animate({ height: [`${from}px`, `${closedHeight()}px`] }, opts);
      fades = content().map(c => c.animate({ opacity: [1, 0] }, { duration: DURATION * 0.6, easing: 'ease-out', fill: 'forwards' }));
      anim.onfinish = () => finish(false);
    }
  });
}
