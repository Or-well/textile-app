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
  padding: 24px;
  background: #eef2f5;
  color: #1f2937;
}

.home-panel {
  width: min(100%, 520px);
  display: grid;
  gap: 14px;
  padding: 28px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.eyebrow,
h1,
p {
  margin: 0;
}

.eyebrow {
  color: #5b6472;
  font-size: 13px;
  font-weight: 700;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

p {
  color: #5b6472;
  line-height: 1.7;
}

.primary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: start;
  min-height: 40px;
  padding: 0 15px;
  border-radius: 6px;
  background: #2f6f73;
  color: #ffffff;
  font-weight: 700;
  text-decoration: none;
}
</style>
