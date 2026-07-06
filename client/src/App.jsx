function App() {
  return (
    <main className="app-shell" aria-label="EPUB Reader">
      <section className="library-home">
        <div>
          <p className="eyebrow">Library</p>
          <h1>我的书架</h1>
        </div>

        <div className="empty-state" role="status">
          <div className="empty-cover" aria-hidden="true" />
          <p>前端项目已就绪，下一步接入后端服务。</p>
        </div>
      </section>
    </main>
  );
}

export default App;
