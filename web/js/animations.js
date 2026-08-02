/* ==========================================================================
 * MES 多孔碳 — 动效模块（GSAP）
 * 在不影响性能的前提下让交互更自然。
 * 设计原则：
 *   - 仅用 transform / opacity（合成层，无重排）
 *   - 使用 stagger 而非多个独立 tween
 *   - 尊重 prefers-reduced-motion
 * ========================================================================== */
(function () {
  "use strict";
  if (typeof gsap === "undefined") return;

  // 检测系统是否启用了 reduce-motion，若启用则只保留瞬时切换
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  gsap.defaults({
    duration: reduce ? 0 : 0.35,
    ease: "power2.out",
  });

  /* ---------- 卡片入场：自动捕获所有视图容器内的 .card ---------- */
  function animateViewCards(view) {
    if (reduce) return;
    // 仅做轻微 Y 位移入场，避免初次 set autoAlpha:0 让卡片短暂不可见（页面看起来发灰）
    const cards = view.querySelectorAll ? view.querySelectorAll(".card") : [];
    if (cards.length === 0) return;

    gsap.fromTo(
      cards,
      { y: 14 },
      {
        y: 0,
        duration: 0.4,
        ease: "power3.out",
        stagger: { each: 0.05, from: "start" },
        clearProps: "transform",
      }
    );
  }

  /* ---------- 顶部工具栏入场（仅一次） ---------- */
  function animateTopbar(topbar) {
    if (reduce) return;
    gsap.from(topbar, { y: -10, autoAlpha: 0, duration: 0.45, ease: "power2.out" });
  }

  /* ---------- 视图淡入（每次渲染调用） ---------- */
  function animateViewSwitch(view) {
    if (reduce) return;
    gsap.from(view, { autoAlpha: 0, duration: 0.25, ease: "power1.out" });
  }

  /* ---------- 按钮悬停轻反馈（事件委托） ---------- */
  function bindButtonHover(root) {
    if (reduce) return;
    // 使用事件代理降低监听开销；卡片、按钮均可
    root.addEventListener(
      "mouseover",
      (e) => {
        const t = e.target.closest(".btn, .card, .seg button, .fmt-pill, .dz");
        if (!t) return;
        gsap.to(t, { scale: 1.02, duration: 0.18, ease: "power2.out", overwrite: "auto" });
      },
      true
    );
    root.addEventListener(
      "mouseout",
      (e) => {
        const t = e.target.closest(".btn, .card, .seg button, .fmt-pill, .dz");
        if (!t) return;
        gsap.to(t, { scale: 1, duration: 0.2, ease: "power2.in", overwrite: "auto" });
      },
      true
    );
  }

  /* ---------- Toast 滑入 ---------- */
  function animateToastIn(toast) {
    if (reduce) return;
    gsap.fromTo(
      toast,
      { x: 40, autoAlpha: 0 },
      { x: 0, autoAlpha: 1, duration: 0.32, ease: "power3.out" }
    );
  }
  function animateToastOut(toast, onComplete) {
    if (reduce) { onComplete && onComplete(); return; }
    gsap.to(toast, {
      x: 40, autoAlpha: 0, duration: 0.25, ease: "power2.in",
      onComplete: onComplete,
    });
  }

  /* ---------- 搜索框获得焦点轻微放大 ---------- */
  function bindSearchFocus(root) {
    if (reduce) return;
    root.addEventListener(
      "focusin",
      (e) => {
        const t = e.target.closest(".search input");
        if (!t) return;
        gsap.to(t.parentElement, { scale: 1.02, duration: 0.25, ease: "power2.out", overwrite: "auto" });
      },
      true
    );
    root.addEventListener(
      "focusout",
      (e) => {
        const t = e.target.closest(".search input");
        if (!t) return;
        gsap.to(t.parentElement, { scale: 1, duration: 0.2, ease: "power2.in", overwrite: "auto" });
      },
      true
    );
  }

  /* ---------- 抽屉/侧滑面板入场（drawer） ---------- */
  function animateDrawerIn(drawer) {
    if (reduce) return;
    gsap.fromTo(drawer, { x: 60, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.32, ease: "power3.out" });
  }

  /* ---------- 导出 API 给 app.js 调用 ---------- */
  window.MESAnimate = {
    viewCards: animateViewCards,
    topbar: animateTopbar,
    viewSwitch: animateViewSwitch,
    btnHover: bindButtonHover,
    search: bindSearchFocus,
    toastIn: animateToastIn,
    toastOut: animateToastOut,
    drawerIn: animateDrawerIn,
    refresh: animateViewSwitch,
  };
})();
