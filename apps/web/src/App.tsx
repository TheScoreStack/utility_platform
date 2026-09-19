import { Authenticator } from "@aws-amplify/ui-react";
import { fetchUserAttributes } from "@aws-amplify/auth";
import "@aws-amplify/ui-react/styles.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  NavLink,
  useLocation,
  Outlet
} from "react-router-dom";
import TripListPage from "./pages/TripListPage";
import TripDetailPage from "./pages/TripDetailPage";
import { useMemo } from "react";
import AboutPage from "./pages/AboutPage";
import ModuleHub from "./pages/ModuleHub";
import DeleteAccountPage from "./pages/DeleteAccountPage";
import PrivacyPage from "./pages/PrivacyPage";
import SupportPage from "./pages/SupportPage";
import TermsPage from "./pages/TermsPage";
import { modules } from "./modules/registry";
import { WorkspaceBadgeIcon } from "./components/icons/UtilityIcons";
import HarmonyLedgerPage from "./pages/HarmonyLedgerPage";
import HarmonyManagePage from "./pages/HarmonyManagePage";
import HarmonyPeoplePage from "./pages/HarmonyPeoplePage";
import HarmonyOverviewPage from "./pages/HarmonyOverviewPage";
import HarmonyStatementsPage from "./pages/HarmonyStatementsPage";
import HarmonyStatementReviewPage from "./pages/HarmonyStatementReviewPage";
import StackTimePage from "./pages/StackTimePage";
import ProfilePage from "./pages/ProfilePage";
import JoinTripPage from "./pages/JoinTripPage";
import TripSummaryPrintPage from "./pages/TripSummaryPrintPage";
import MeetListPage from "./pages/MeetListPage";
import MeetEventPage from "./pages/MeetEventPage";
import MeetRespondPage from "./pages/MeetRespondPage";
import MeetJoinPage from "./pages/MeetJoinPage";
import SplitClaimPage from "./pages/SplitClaimPage";
import { useHarmonyLedgerAccess } from "./modules/useHarmonyLedgerAccess";
import { useStackTimeAccess } from "./modules/useStackTimeAccess";
import { getInitials, seedAvatar } from "./lib/avatarPalette";
import { ConfirmDialogProvider } from "./components/ConfirmDialog";
import { TripsRail } from "./components/trip/TripsRail";

const queryClient = new QueryClient();

/** Pages without a context rail keep a comfortable centred reading column. */
const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="canvas canvas--centered">{children}</div>
);
const CenteredOutlet = () => (
  <Centered>
    <Outlet />
  </Centered>
);

/** Group expenses is the one module with a context rail: the trip you are
 *  looking at is one of several you move between. The print view and the
 *  invite-accept page are single-purpose, so they keep the plain column. */
const GroupExpensesModule = () => {
  const { pathname } = useLocation();
  const railed =
    pathname.startsWith("/group-expenses/trips") &&
    !pathname.endsWith("/summary");

  if (!railed) return <CenteredOutlet />;

  return (
    <div className="appframe">
      <TripsRail />
      <div className="canvas">
        <Outlet />
      </div>
    </div>
  );
};

const HarmonyModule = CenteredOutlet;
const MeetModule = CenteredOutlet;

interface AmplifyUser {
  attributes?: Record<string, string>;
  signInDetails?: { loginId?: string };
  username?: string;
}

interface AppContentProps {
  user?: AmplifyUser;
  signOut?: () => void;
}

/** "hunter.j.adam" -> "Hunter" — a presentable fallback while attributes load. */
const nameFromEmail = (email?: string) => {
  const local = email?.split("@")[0]?.split(/[._-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : undefined;
};

const AppContent = ({ user, signOut }: AppContentProps) => {
  // Amplify v6's Authenticator user has no attributes — fetch them ourselves.
  const { data: attributes } = useQuery({
    queryKey: ["user-attributes"],
    queryFn: () => fetchUserAttributes(),
    staleTime: Infinity
  });
  const { data: harmonyAccess } = useHarmonyLedgerAccess();
  const { data: stackTimeAccess } = useStackTimeAccess();

  const availableModules = useMemo(() => {
    return modules.filter((module) => {
      if (!module.restricted) {
        return true;
      }
      if (module.id === "harmony-ledger") {
        return harmonyAccess?.allowed ?? false;
      }
      if (module.id === "stack-time") {
        return stackTimeAccess?.allowed ?? false;
      }
      return true;
    });
  }, [harmonyAccess?.allowed, stackTimeAccess?.allowed]);

  const email = attributes?.email || user?.signInDetails?.loginId;
  const fullName = [attributes?.given_name, attributes?.family_name]
    .filter(Boolean)
    .join(" ");
  const displayName =
    fullName || attributes?.name || nameFromEmail(email) || user?.username;

  const firstName = attributes?.given_name || nameFromEmail(email);
  const emailSeed = email || displayName || "anon";
  const avatarPalette = seedAvatar(emailSeed);
  const avatarInitials = getInitials(displayName ?? firstName ?? "?");
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "Up late";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Late hours";
  }, []);

  return (
    <BrowserRouter>
      <ConfirmDialogProvider>
      <div className="appshell">
        <header className="topbar">
          <NavLink to="/" className="topbar__wordmark" aria-label="The Stack Core — home">
            <span className="shell-wordmark">
              <span className="shell-wordmark__the">The</span>
              <span className="shell-wordmark__stack">Stack</span>
              <span className="shell-wordmark__core">Core</span>
            </span>
          </NavLink>

          <nav className="topnav" aria-label="Tools">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "topnav__link topnav__link--active" : "topnav__link"
              }
            >
              All tools
            </NavLink>
            {availableModules.map((module) => (
              <NavLink
                key={module.id}
                to={module.path}
                className={({ isActive }) =>
                  isActive ? "topnav__link topnav__link--active" : "topnav__link"
                }
              >
                {module.name}
              </NavLink>
            ))}
          </nav>

          <div className="topbar__who">
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                isActive ? "shell-user shell-user--active" : "shell-user"
              }
              title={greeting + (firstName ? `, ${firstName}` : "")}
            >
              <span
                className="shell-user__avatar"
                style={{ background: avatarPalette.bg, color: avatarPalette.fg }}
                aria-hidden="true"
              >
                {avatarInitials}
              </span>
              {displayName && (
                <span className="shell-user__name">{firstName ?? displayName}</span>
              )}
            </NavLink>
            <button
              type="button"
              className="shell-signout"
              onClick={() => signOut?.()}
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="appbody">
        <Routes>
          <Route
            path="/"
            element={
              <Centered>
                <ModuleHub
                  modules={availableModules}
                  firstName={firstName ?? displayName}
                />
              </Centered>
            }
          />
          <Route
            path="/profile"
            element={
              <Centered>
                <ProfilePage />
              </Centered>
            }
          />
          <Route path="/group-expenses" element={<GroupExpensesModule />}>
            <Route index element={<Navigate to="trips" replace />} />
            <Route path="trips" element={<TripListPage />} />
            <Route path="trips/:tripId" element={<TripDetailPage />} />
            <Route path="trips/:tripId/summary" element={<TripSummaryPrintPage />} />
            <Route path="join/:inviteId" element={<JoinTripPage />} />
          </Route>
          <Route path="/meet" element={<MeetModule />}>
            <Route index element={<MeetListPage />} />
            <Route path="events/:eventId" element={<MeetEventPage />} />
            <Route path="join/:slug" element={<MeetJoinPage />} />
          </Route>
          <Route path="/harmony-ledger" element={<HarmonyModule />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<HarmonyOverviewPage />} />
            <Route path="ledger" element={<HarmonyLedgerPage />} />
            <Route path="statements" element={<HarmonyStatementsPage />} />
            <Route path="manage" element={<HarmonyManagePage />} />
            <Route path="people" element={<HarmonyPeoplePage />} />
            <Route
              path="statements/:statementId"
              element={<HarmonyStatementReviewPage />}
            />
          </Route>
          <Route
            path="/stack-time"
            element={
              <Centered>
                <StackTimePage />
              </Centered>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </div>
      </div>
      </ConfirmDialogProvider>
    </BrowserRouter>
  );
};

const App = () => {
  const authComponents = useMemo(
    () => ({
      SignIn: {
        Header() {
          return (
            <div className="auth-hero">
              <WorkspaceBadgeIcon className="auth-hero-icon" />
              <div>
                <h2>The Stack Core</h2>
                <p>Single sign-on for every tool in your stack.</p>
              </div>
            </div>
          );
        }
      }
    }),
    []
  );

  const formFields = useMemo(
    () => ({
      signUp: {
        given_name: {
          order: 1,
          isRequired: true,
          label: "First name",
          placeholder: "Jane"
        },
        family_name: {
          order: 2,
          isRequired: true,
          label: "Last name",
          placeholder: "Smith"
        },
        email: {
          order: 3
        },
        password: {
          order: 4
        },
        confirm_password: {
          order: 5
        }
      }
    }),
    []
  );

  // Public pages render outside the Authenticator — App Store reviewers
  // (and signed-out users) must be able to read these.
  // Meet respond links (/m/<slug>) are answered by guests without accounts,
  // so they get a standalone page with no Authenticator and no Router.
  if (window.location.pathname.startsWith("/m/")) {
    return <MeetRespondPage />;
  }

  // Split links (/s/<shareId>) work the same way: guests claim their receipt
  // items and pay without an account, so no Authenticator and no Router.
  if (window.location.pathname.startsWith("/s/")) {
    return <SplitClaimPage />;
  }

  switch (window.location.pathname) {
    case "/privacy":
      return <PrivacyPage />;
    case "/support":
      return <SupportPage />;
    case "/terms":
      return <TermsPage />;
    case "/about":
      return <AboutPage />;
    case "/delete-account":
      return <DeleteAccountPage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Authenticator components={authComponents} formFields={formFields}>
        {(facade) => <AppContent {...facade} />}
      </Authenticator>
    </QueryClientProvider>
  );
};

export default App;
