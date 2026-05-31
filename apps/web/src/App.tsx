import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  NavLink,
  Outlet
} from "react-router-dom";
import TripListPage from "./pages/TripListPage";
import TripDetailPage from "./pages/TripDetailPage";
import { useMemo } from "react";
import ModuleHub from "./pages/ModuleHub";
import { modules } from "./modules/registry";
import { WorkspaceBadgeIcon } from "./components/icons/UtilityIcons";
import HarmonyLedgerPage from "./pages/HarmonyLedgerPage";
import HarmonyOverviewPage from "./pages/HarmonyOverviewPage";
import StackTimePage from "./pages/StackTimePage";
import ProfilePage from "./pages/ProfilePage";
import { useHarmonyLedgerAccess } from "./modules/useHarmonyLedgerAccess";
import { useStackTimeAccess } from "./modules/useStackTimeAccess";
import { getInitials, seedAvatar } from "./lib/avatarPalette";

const queryClient = new QueryClient();
const GroupExpensesModule = () => <Outlet />;
const HarmonyModule = () => <Outlet />;

interface AmplifyUser {
  attributes?: Record<string, string>;
  signInDetails?: { loginId?: string };
  username?: string;
}

interface AppContentProps {
  user?: AmplifyUser;
  signOut?: () => void;
}

const AppContent = ({ user, signOut }: AppContentProps) => {
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

  const fullName = [user?.attributes?.given_name, user?.attributes?.family_name]
    .filter(Boolean)
    .join(" ");
  const displayName =
    fullName ||
    user?.attributes?.name ||
    user?.signInDetails?.loginId ||
    user?.username;

  const firstName = user?.attributes?.given_name;
  const emailSeed =
    user?.attributes?.email ||
    user?.signInDetails?.loginId ||
    displayName ||
    "anon";
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
      <main className="app-container">
        <header className="shell-header">
          <div className="shell-header__lockup">
            <NavLink to="/" className="shell-wordmark-link" aria-label="The Stack Core — home">
              <span className="shell-wordmark">
                <span className="shell-wordmark__the">The</span>
                <span className="shell-wordmark__stack">Stack</span>
                <span className="shell-wordmark__core">Core</span>
              </span>
            </NavLink>
            {displayName && (
              <p className="shell-greeting">
                {greeting},{" "}
                <span className="shell-greeting__name">{firstName ?? displayName}</span>.
              </p>
            )}
          </div>

          <div className="shell-actions">
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                isActive ? "shell-user shell-user--active" : "shell-user"
              }
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

          <nav className="shell-nav" aria-label="Tools">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "shell-nav__link shell-nav__link--active" : "shell-nav__link"
              }
            >
              All tools
            </NavLink>
            {availableModules.map((module) => (
              <NavLink
                key={module.id}
                to={module.path}
                className={({ isActive }) =>
                  isActive ? "shell-nav__link shell-nav__link--active" : "shell-nav__link"
                }
              >
                {module.name}
              </NavLink>
            ))}
          </nav>
        </header>

        <Routes>
          <Route
            path="/"
            element={
              <ModuleHub
                modules={availableModules}
                firstName={firstName ?? displayName}
              />
            }
          />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/group-expenses" element={<GroupExpensesModule />}>
            <Route index element={<Navigate to="trips" replace />} />
            <Route path="trips" element={<TripListPage />} />
            <Route path="trips/:tripId" element={<TripDetailPage />} />
          </Route>
          <Route path="/harmony-ledger" element={<HarmonyModule />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<HarmonyOverviewPage />} />
            <Route path="ledger" element={<HarmonyLedgerPage />} />
          </Route>
          <Route path="/stack-time" element={<StackTimePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
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

  return (
    <QueryClientProvider client={queryClient}>
      <Authenticator components={authComponents} formFields={formFields}>
        {(facade) => <AppContent {...facade} />}
      </Authenticator>
    </QueryClientProvider>
  );
};

export default App;
