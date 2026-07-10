import { NavLink } from "react-router-dom";
import { useHarmonyLedgerAccess } from "../modules/useHarmonyLedgerAccess";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "hl-subnav__link hl-subnav__link--active" : "hl-subnav__link";

// Viewers get the overview and nothing else; the rest of Harmony is the
// admins' workbench.
const HarmonySubNav = () => {
  const { data } = useHarmonyLedgerAccess();
  const isAdmin = data?.isAdmin ?? false;

  return (
    <div className="hl-subnav" role="tablist" aria-label="Harmony sections">
      <NavLink to="/harmony-ledger/overview" role="tab" className={tabClass}>
        Overview
      </NavLink>
      {isAdmin && (
        <>
          <NavLink to="/harmony-ledger/ledger" role="tab" className={tabClass}>
            Ledger
          </NavLink>
          <NavLink to="/harmony-ledger/statements" role="tab" className={tabClass}>
            Statements
          </NavLink>
          <NavLink to="/harmony-ledger/manage" role="tab" className={tabClass}>
            Manage
          </NavLink>
          <NavLink to="/harmony-ledger/people" role="tab" className={tabClass}>
            People
          </NavLink>
        </>
      )}
    </div>
  );
};

export default HarmonySubNav;
