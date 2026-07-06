import { NavLink } from "react-router-dom";

const HarmonySubNav = () => (
  <div className="hl-subnav" role="tablist" aria-label="Harmony sections">
    <NavLink
      to="/harmony-ledger/overview"
      role="tab"
      className={({ isActive }) =>
        isActive ? "hl-subnav__link hl-subnav__link--active" : "hl-subnav__link"
      }
    >
      Overview
    </NavLink>
    <NavLink
      to="/harmony-ledger/ledger"
      role="tab"
      className={({ isActive }) =>
        isActive ? "hl-subnav__link hl-subnav__link--active" : "hl-subnav__link"
      }
    >
      Ledger
    </NavLink>
    <NavLink
      to="/harmony-ledger/statements"
      role="tab"
      className={({ isActive }) =>
        isActive ? "hl-subnav__link hl-subnav__link--active" : "hl-subnav__link"
      }
    >
      Statements
    </NavLink>
  </div>
);

export default HarmonySubNav;
