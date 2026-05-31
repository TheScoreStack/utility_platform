import { Link } from "react-router-dom";
import type { ModuleDefinition } from "../modules/registry";

interface ModuleHubProps {
  modules: ModuleDefinition[];
  firstName?: string;
}

const statusCopy: Record<ModuleDefinition["maturity"], string> = {
  alpha: "Preview",
  beta: "In beta",
  stable: "Stable"
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const formatTodayDate = (): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric"
    }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
};

const dayOfYear = (): number => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

const subline = (count: number): string => {
  if (count === 0) return "No tools yet — invite yourself in.";
  if (count === 1) return "One workspace, ready when you are.";
  const roman = ROMAN[count - 1] ?? String(count);
  return `${roman} rooms in the house — pick where to start.`;
};

const ModuleHub = ({ modules, firstName }: ModuleHubProps) => {
  const today = formatTodayDate();
  const folio = dayOfYear();
  const name = firstName?.trim() || "friend";

  return (
    <div className="hub">
      <section className="hub-hero">
        <span className="hub-hero__date">{today}</span>
        <h1 className="hub-hero__greeting">
          Welcome back, <strong>{name}</strong>.
        </h1>
        <p className="hub-hero__sub">{subline(modules.length)}</p>
        <div className="hub-hero__rule" aria-hidden="true" />
        <span className="hub-hero__folio" aria-hidden="true">
          No.&nbsp;{folio}
        </span>
      </section>

      <section className="hub-section">
        <div className="hub-section-head">
          <h2 className="hub-section-head__title">Your tools</h2>
          <span className="hub-section-head__count">
            {modules.length} {modules.length === 1 ? "module" : "modules"}
          </span>
        </div>

        {modules.length === 0 ? (
          <div className="hub-empty">
            <div className="hub-empty__mark">∅</div>
            <p className="hub-empty__title">Nothing here yet.</p>
            <p className="hub-empty__hint">
              You don’t have access to any modules. Ask whoever runs the workspace to bring you in.
            </p>
          </div>
        ) : (
          <div className="hub-grid">
            {modules.map((module, idx) => (
              <Link
                key={module.id}
                to={module.path}
                className={`hub-card hub-card--${module.id}`}
              >
                <div className="hub-card__top">
                  <div className="hub-card__chapter">
                    <span className="hub-card__numeral">{ROMAN[idx] ?? String(idx + 1)}</span>
                    <p className="hub-card__status">
                      <span className="hub-card__status-dot" aria-hidden="true" />
                      {statusCopy[module.maturity]}
                    </p>
                  </div>
                  {module.icon && <div className="hub-card__icon">{module.icon}</div>}
                </div>

                <div className="hub-card__body">
                  <h3 className="hub-card__title">{module.name}</h3>
                  <p className="hub-card__desc">{module.description}</p>
                </div>

                <div className="hub-card__foot">
                  <div className="hub-card__tags">
                    {module.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="hub-card__tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <span className="hub-card__open">Open →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default ModuleHub;
