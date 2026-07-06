export const TripDetailSkeleton = () => (
  <div className="trip-detail">
    <section className="card" style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
          <span className="skel skel--title" style={{ width: "220px" }}>&nbsp;</span>
          <span className="skel skel--text" style={{ width: "150px" }}>&nbsp;</span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <span className="skel skel--pill" style={{ width: "120px" }}>&nbsp;</span>
        </div>
      </div>
      <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {["overview", "expenses", "settlements", "people"].map((id) => (
          <span key={id} className="skel skel--pill" style={{ width: `${80 + (id.length % 3) * 14}px` }}>&nbsp;</span>
        ))}
      </div>
    </section>

    <div className="ov-grid">
      <section
        className="ov-hero"
        style={{ gridColumn: "1 / -1", background: "var(--surface)" }}
      >
        <div className="skel-hero">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "1.5rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", flex: 1, minWidth: 0 }}>
              <span className="skel skel--text" style={{ width: "120px", height: "0.7rem" }}>&nbsp;</span>
              <span className="skel skel-hero__amount">&nbsp;</span>
              <span className="skel skel--text" style={{ width: "150px" }}>&nbsp;</span>
            </div>
            <span className="skel skel--pill" style={{ width: "160px", height: "2.6rem" }}>&nbsp;</span>
          </div>
          <div className="skel-stamps">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel-stamp">
                <span className="skel skel--text" style={{ width: "80px", height: "0.7rem" }}>&nbsp;</span>
                <span className="skel skel--title" style={{ width: "100px" }}>&nbsp;</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="ov-section-head">
          <span className="skel skel--title" style={{ width: "110px" }}>&nbsp;</span>
        </div>
        <div className="ov-suggestion-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="ov-suggestion">
              <div className="skel-row">
                <span className="skel skel--circle" style={{ width: "38px", height: "38px" }}>&nbsp;</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <span className="skel skel--text" style={{ width: "50px", height: "0.6rem" }}>&nbsp;</span>
                  <span className="skel skel--text" style={{ width: "90px" }}>&nbsp;</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem" }}>
                <span className="skel skel--title" style={{ width: "80px" }}>&nbsp;</span>
                <span className="skel skel--text" style={{ width: "120px", height: "0.5rem" }}>&nbsp;</span>
              </div>
              <span className="skel skel--pill" style={{ width: "90px" }}>&nbsp;</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="ov-section-head">
          <span className="skel skel--title" style={{ width: "100px" }}>&nbsp;</span>
        </div>
        <div className="ov-balance-list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ov-balance-row" style={{ cursor: "default" }}>
              <span className="skel skel--circle" style={{ width: "32px", height: "32px" }}>&nbsp;</span>
              <div className="ov-balance-row__body">
                <span className="skel skel--text" style={{ width: `${110 + (i * 17) % 60}px` }}>&nbsp;</span>
                <div className="ov-balance-row__bar">
                  <span
                    className="skel ov-balance-row__bar-fill"
                    style={{ width: `${30 + (i * 18) % 55}%`, animation: "skelShimmer 1.6s ease-in-out infinite" }}
                  />
                </div>
              </div>
              <span className="skel skel--text" style={{ width: "60px" }}>&nbsp;</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  </div>
);
