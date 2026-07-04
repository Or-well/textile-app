<template>
  <main class="home-page">
    <section class="home-panel">
      <p class="eyebrow">Textile</p>
      <h1>项目启动中心已迁移</h1>
      <p>
        创建项目、打开项目文件夹、最近项目和 .hproj 入口现在统一放在项目启动页。
      </p>
      <a class="primary-link" href="/projects">进入项目启动页</a>
    </section>
  </main>
</template>

<style scoped>
.home-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-8);
  background: var(--color-shell);
  color: var(--color-text);
}

.home-panel {
  width: min(100%, 520px);
  display: grid;
  gap: var(--space-4);
  padding: var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.eyebrow,
h1,
p {
  margin: 0;
}

.eyebrow {
  color: var(--color-muted);
  font-size: var(--font-sm);
  font-weight: 700;
}

h1 {
  color: var(--color-heading);
  font-size: 24px;
  line-height: 1.2;
}

p {
  color: var(--color-muted);
  line-height: 1.5;
}

.primary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: start;
  min-height: var(--control-md);
  padding: 0 var(--space-5);
  border-radius: var(--radius-sm);
  background: var(--color-brand);
  color: var(--color-surface);
  font-weight: 700;
  text-decoration: none;
}
</style>
