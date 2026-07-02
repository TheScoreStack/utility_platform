import { nanoid } from "nanoid";
import { z } from "zod";
import type { AuthContext } from "../auth.js";
import { StackTimeStore } from "../data/stackTimeStore.js";
import { UserStore } from "../data/userStore.js";
import { ForbiddenError, ValidationError } from "../lib/errors.js";
import type {
  StackTimeAccessRecord,
  StackTimeEntry,
  StackTimeProject,
  UserProfile
} from "../types.js";

const DEFAULT_ADMIN_EMAILS = ["hunter.j.adam@gmail.com"].map((email) =>
  email.toLowerCase()
);

const DEFAULT_PROJECTS: Array<{ projectId: string; name: string }> = [
  { projectId: "score-stack", name: "The Score Stack" },
  { projectId: "rfp", name: "RFP" },
  { projectId: "referral-buddy", name: "Referral Buddy" },
  { projectId: "stack-website", name: "The Stack Technologies Website" },
  { projectId: "utility-platform", name: "Utility Platform" },
  { projectId: "harmony-website", name: "Harmony Collective Website" },
  { projectId: "miscellaneous", name: "Miscellaneous" }
];

const addAccessSchema = z.object({
  userId: z.string().min(1),
  isAdmin: z.boolean().optional()
});

const createProjectSchema = z.object({
  name: z.string().min(1).max(100)
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional()
});

const createEntrySchema = z.object({
  userId: z.string().min(1).optional(), // Admin can specify for others
  projectId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  hours: z.number().positive().max(24),
  description: z.string().max(500).optional()
});

const updateEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"), // Original date for lookup
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(), // New date if changing
  projectId: z.string().min(1).optional(),
  hours: z.number().positive().max(24).optional(),
  description: z.string().max(500).optional()
});

const deleteEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
});

export interface StackTimeAccessResponse {
  allowed: boolean;
  isAdmin: boolean;
  members?: StackTimeAccessRecord[];
  currentAccessId?: string;
}

export interface StackTimeEntriesResponse {
  entries: StackTimeEntry[];
  totalHours: number;
}

export interface StackTimeReportByProject {
  projectId: string;
  projectName: string;
  totalHours: number;
  entryCount: number;
}

export interface StackTimeReportByPerson {
  userId: string;
  displayName: string;
  totalHours: number;
  entryCount: number;
  byProject: StackTimeReportByProject[];
}

export interface WeeklyBreakdown {
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string; // YYYY-MM-DD (Sunday)
  hours: number;
  entryCount: number;
}

export interface MemberTimelineStats {
  userId: string;
  displayName: string;
  totalHours: number;
  entryCount: number;
  avgHoursPerEntry: number;
  avgHoursPerWeek: number;
  activeDays: number;
  firstEntryDate: string | null;
  lastEntryDate: string | null;
  weeklyBreakdown: WeeklyBreakdown[];
  byProject: StackTimeReportByProject[];
}

export interface TimelineStatsResponse {
  startDate: string;
  endDate: string;
  totalHours: number;
  totalEntries: number;
  activeMembers: number;
  weeksInPeriod: number;
  members: MemberTimelineStats[];
}

const isoNow = () => new Date().toISOString();

const displayNameFromProfile = (profile: UserProfile): string =>
  profile.displayName ?? profile.email ?? profile.userId;

export class StackTimeService {
  private readonly store = new StackTimeStore();
  private readonly userStore = new UserStore();
  private bootstrapPromise: Promise<void> | null = null;
  private projectBootstrapPromise: Promise<void> | null = null;

  private normalizeEmail(email?: string | null): string | null {
    return email ? email.trim().toLowerCase() : null;
  }

  private async ensureDefaultAdminAccess(): Promise<void> {
    if (this.bootstrapPromise) {
      await this.bootstrapPromise;
      return;
    }

    this.bootstrapPromise = (async () => {
      for (const email of DEFAULT_ADMIN_EMAILS) {
        const existing = await this.store.findAccessByEmail(email);
        if (!existing) {
          await this.store.createAccessRecord({
            accessId: nanoid(12),
            email,
            normalizedEmail: email,
            displayName: "Hunter Adam",
            isAdmin: true,
            addedAt: isoNow(),
            addedBy: "system",
            addedByName: "System"
          });
        } else if (existing.displayName === "Stack Time Admin") {
          // Fix up old display name
          await this.store.updateAccessDisplayName(existing.accessId, "Hunter Adam");
        }
      }
    })();

    await this.bootstrapPromise;
    this.bootstrapPromise = null;
  }

  private async ensureDefaultProjects(): Promise<void> {
    if (this.projectBootstrapPromise) {
      await this.projectBootstrapPromise;
      return;
    }

    this.projectBootstrapPromise = (async () => {
      const existingProjects = await this.store.listProjects();
      const existingIds = new Set(existingProjects.map((p) => p.projectId));
      for (const project of DEFAULT_PROJECTS) {
        if (!existingIds.has(project.projectId)) {
          const now = isoNow();
          await this.store.createProject({
            projectId: project.projectId,
            name: project.name,
            isActive: true,
            createdAt: now,
            createdBy: "system"
          });
        }
      }
    })();

    await this.projectBootstrapPromise;
    this.projectBootstrapPromise = null;
  }

  private async resolveAccessForProfile(
    profile: UserProfile
  ): Promise<StackTimeAccessRecord | null> {
    await this.ensureDefaultAdminAccess();
    let access = await this.store.findAccessByUserId(profile.userId);
    if (access) {
      return access;
    }

    const normalizedEmail = this.normalizeEmail(profile.email);
    if (!normalizedEmail) {
      return null;
    }

    access = await this.store.findAccessByEmail(normalizedEmail);
    if (access && !access.userId) {
      await this.store.attachUserToAccess(access.accessId, profile.userId);
      access = { ...access, userId: profile.userId };
    }
    return access;
  }

  private async requireAccess(auth: AuthContext): Promise<{
    profile: UserProfile;
    access: StackTimeAccessRecord;
  }> {
    const profile = await this.userStore.ensureUserProfile(auth);
    const access = await this.resolveAccessForProfile(profile);
    if (!access) {
      throw new ForbiddenError("You do not have access to Stack Time yet.");
    }
    return { profile, access };
  }

  private async requireAdmin(auth: AuthContext): Promise<{
    profile: UserProfile;
    access: StackTimeAccessRecord;
  }> {
    const context = await this.requireAccess(auth);
    if (!context.access.isAdmin) {
      throw new ForbiddenError("Only Stack Time admins can perform this action.");
    }
    return context;
  }

  // Access management

  async getAccessOverview(auth: AuthContext): Promise<StackTimeAccessResponse> {
    const profile = await this.userStore.ensureUserProfile(auth);
    const access = await this.resolveAccessForProfile(profile);
    if (!access) {
      return {
        allowed: false,
        isAdmin: false
      };
    }

    const members = await this.store.listAccessRecords();
    return {
      allowed: true,
      isAdmin: access.isAdmin,
      members,
      currentAccessId: access.accessId
    };
  }

  async addAccess(body: unknown, auth: AuthContext): Promise<StackTimeAccessRecord> {
    const { profile } = await this.requireAdmin(auth);
    const parsed = addAccessSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const payload = parsed.data;

    // Check for existing access by userId
    const existingByUserId = await this.store.findAccessByUserId(payload.userId);
    if (existingByUserId) {
      throw new ValidationError("This person already has access.");
    }

    const targetProfile = await this.userStore.getUser(payload.userId);
    if (!targetProfile) {
      throw new ValidationError("Unable to find that user profile.");
    }

    // Also check by email to catch cases where they were added by email before signing up
    const normalizedEmail = this.normalizeEmail(targetProfile.email);
    if (normalizedEmail) {
      const existingByEmail = await this.store.findAccessByEmail(normalizedEmail);
      if (existingByEmail) {
        // If found by email but not by userId, attach userId to existing record
        if (!existingByEmail.userId) {
          await this.store.attachUserToAccess(existingByEmail.accessId, targetProfile.userId);
        }
        throw new ValidationError("This person already has access.");
      }
    }

    const displayName = targetProfile.displayName ?? targetProfile.email ?? targetProfile.userId;

    const accessRecord = await this.store.createAccessRecord({
      accessId: nanoid(12),
      userId: targetProfile.userId,
      email: targetProfile.email,
      normalizedEmail: normalizedEmail ?? undefined,
      displayName,
      isAdmin: payload.isAdmin ?? false,
      addedAt: isoNow(),
      addedBy: profile.userId,
      addedByName: displayNameFromProfile(profile)
    });

    return accessRecord;
  }

  async removeAccess(accessId: string, auth: AuthContext): Promise<void> {
    const { access: actingAccess } = await this.requireAdmin(auth);
    if (actingAccess.accessId === accessId) {
      throw new ValidationError("You cannot remove your own access.");
    }
    await this.store.deleteAccessRecord(accessId);
  }

  // Projects

  async listProjects(auth: AuthContext): Promise<StackTimeProject[]> {
    await this.requireAccess(auth);
    await this.ensureDefaultProjects();
    return this.store.listProjects();
  }

  async createProject(body: unknown, auth: AuthContext): Promise<StackTimeProject> {
    const { profile } = await this.requireAdmin(auth);
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const now = isoNow();
    const project: StackTimeProject = {
      projectId: `proj_${nanoid(10)}`,
      name: parsed.data.name,
      isActive: true,
      createdAt: now,
      createdBy: profile.userId
    };

    await this.store.createProject(project);
    return project;
  }

  async updateProject(
    projectId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<StackTimeProject> {
    await this.requireAdmin(auth);
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const project = await this.store.getProject(projectId);
    if (!project) {
      throw new ValidationError("Project not found.");
    }

    await this.store.updateProject(projectId, parsed.data);

    return {
      ...project,
      name: parsed.data.name ?? project.name,
      isActive: parsed.data.isActive ?? project.isActive
    };
  }

  // Time entries

  async listEntries(
    auth: AuthContext,
    query: { startDate?: string; endDate?: string; userId?: string }
  ): Promise<StackTimeEntriesResponse> {
    const { profile, access } = await this.requireAccess(auth);
    await this.ensureDefaultProjects();

    let entries: StackTimeEntry[];
    const dateRange = {
      startDate: query.startDate,
      endDate: query.endDate
    };

    if (query.userId && query.userId !== profile.userId) {
      // Viewing someone else's entries requires admin
      if (!access.isAdmin) {
        throw new ForbiddenError("Only admins can view other users' entries.");
      }
      entries = await this.store.listEntriesForUser(query.userId, dateRange);
    } else {
      // Viewing own entries
      entries = await this.store.listEntriesForUser(profile.userId, dateRange);
    }

    const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);

    return { entries, totalHours };
  }

  async listTeamEntries(
    auth: AuthContext,
    query: { startDate?: string; endDate?: string }
  ): Promise<{ entries: StackTimeEntry[]; totalHours: number }> {
    const { access } = await this.requireAccess(auth);

    if (!access.isAdmin) {
      throw new ForbiddenError("Only admins can view team entries.");
    }

    await this.ensureDefaultProjects();

    const entries = await this.store.listAllEntries({
      startDate: query.startDate,
      endDate: query.endDate
    });

    // Sort by date descending, then by createdAt descending
    entries.sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return b.createdAt.localeCompare(a.createdAt);
    });

    const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);

    return { entries, totalHours };
  }

  async createEntry(body: unknown, auth: AuthContext): Promise<StackTimeEntry> {
    const { profile, access } = await this.requireAccess(auth);
    await this.ensureDefaultProjects();

    const parsed = createEntrySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const payload = parsed.data;

    // Determine target user
    let targetUserId = profile.userId;
    let targetDisplayName = displayNameFromProfile(profile);

    // If userId is specified and it's different from the current user, this is an admin logging for someone else
    if (payload.userId && payload.userId !== profile.userId) {
      // Logging for someone else requires admin
      if (!access.isAdmin) {
        throw new ForbiddenError("Only admins can log time for other users.");
      }
      const targetProfile = await this.userStore.getUser(payload.userId);
      if (!targetProfile) {
        throw new ValidationError("Target user not found.");
      }
      // Verify target has access (use their profile which will check by userId AND email)
      const targetAccess = await this.resolveAccessForProfile(targetProfile);
      if (!targetAccess) {
        throw new ValidationError("Target user does not have Stack Time access.");
      }
      targetUserId = payload.userId;
      targetDisplayName = displayNameFromProfile(targetProfile);
    } else if (payload.userId && payload.userId === profile.userId) {
      // Admin selected themselves from the dropdown - just use their own profile (already verified)
      // No additional checks needed since we already verified access via requireAccess()
    }

    // Validate project
    const project = await this.store.getProject(payload.projectId);
    if (!project) {
      throw new ValidationError("Project not found.");
    }
    if (!project.isActive) {
      throw new ValidationError("Cannot log time to an inactive project.");
    }

    const now = isoNow();
    const entry: StackTimeEntry = {
      entryId: `time_${nanoid(10)}`,
      userId: targetUserId,
      userDisplayName: targetDisplayName,
      projectId: payload.projectId,
      projectName: project.name,
      date: payload.date,
      hours: payload.hours,
      description: payload.description,
      createdAt: now,
      updatedAt: now,
      createdBy: profile.userId,
      createdByName: displayNameFromProfile(profile)
    };

    await this.store.createEntry(entry);
    return entry;
  }

  async updateEntry(
    entryId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<StackTimeEntry> {
    const { profile, access } = await this.requireAccess(auth);

    const parsed = updateEntrySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const { date, newDate, ...updates } = parsed.data;

    // Find the entry - need to search the user's entries
    // First check if it's the current user's entry
    let entry = await this.store.getEntry(profile.userId, date, entryId);
    let entryUserId = profile.userId;

    if (!entry && access.isAdmin) {
      // Admin might be updating someone else's entry - need to find it
      const allEntries = await this.store.listAllEntries({ startDate: date, endDate: date });
      const found = allEntries.find((e) => e.entryId === entryId);
      if (found) {
        entry = found;
        entryUserId = found.userId;
      }
    }

    if (!entry) {
      throw new ValidationError("Entry not found.");
    }

    // Check authorization
    if (entry.userId !== profile.userId && !access.isAdmin) {
      throw new ForbiddenError("You can only update your own entries.");
    }

    // Validate project if changing
    let projectName = entry.projectName;
    if (updates.projectId) {
      const project = await this.store.getProject(updates.projectId);
      if (!project) {
        throw new ValidationError("Project not found.");
      }
      if (!project.isActive) {
        throw new ValidationError("Cannot log time to an inactive project.");
      }
      projectName = project.name;
    }

    const now = isoNow();

    // If date is changing, we need to delete and recreate (date is part of SK)
    if (newDate && newDate !== date) {
      const updatedEntry: StackTimeEntry = {
        ...entry,
        projectId: updates.projectId ?? entry.projectId,
        projectName,
        date: newDate,
        hours: updates.hours ?? entry.hours,
        description: updates.description ?? entry.description,
        updatedAt: now
      };
      await this.store.moveEntry(entryUserId, date, entryId, updatedEntry);
      return updatedEntry;
    }

    // Otherwise, just update in place
    await this.store.updateEntry(entryUserId, date, entryId, {
      ...updates,
      projectName,
      updatedAt: now
    });

    return {
      ...entry,
      projectId: updates.projectId ?? entry.projectId,
      projectName,
      hours: updates.hours ?? entry.hours,
      description: updates.description ?? entry.description,
      updatedAt: now
    };
  }

  async deleteEntry(entryId: string, body: unknown, auth: AuthContext): Promise<void> {
    const { profile, access } = await this.requireAccess(auth);

    const parsed = deleteEntrySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const { date } = parsed.data;

    // Find the entry
    let entry = await this.store.getEntry(profile.userId, date, entryId);
    let entryUserId = profile.userId;

    if (!entry && access.isAdmin) {
      const allEntries = await this.store.listAllEntries({ startDate: date, endDate: date });
      const found = allEntries.find((e) => e.entryId === entryId);
      if (found) {
        entry = found;
        entryUserId = found.userId;
      }
    }

    if (!entry) {
      throw new ValidationError("Entry not found.");
    }

    if (entry.userId !== profile.userId && !access.isAdmin) {
      throw new ForbiddenError("You can only delete your own entries.");
    }

    await this.store.deleteEntry(entryUserId, date, entryId);
  }

  // Reports

  async getReportByProject(
    auth: AuthContext,
    query: { startDate?: string; endDate?: string }
  ): Promise<StackTimeReportByProject[]> {
    await this.requireAccess(auth);
    await this.ensureDefaultProjects();

    const entries = await this.store.listAllEntries({
      startDate: query.startDate,
      endDate: query.endDate
    });

    const projectMap = new Map<string, StackTimeReportByProject>();

    for (const entry of entries) {
      const existing = projectMap.get(entry.projectId);
      if (existing) {
        existing.totalHours += entry.hours;
        existing.entryCount += 1;
      } else {
        projectMap.set(entry.projectId, {
          projectId: entry.projectId,
          projectName: entry.projectName ?? entry.projectId,
          totalHours: entry.hours,
          entryCount: 1
        });
      }
    }

    return Array.from(projectMap.values()).sort((a, b) => b.totalHours - a.totalHours);
  }

  async getReportByPerson(
    auth: AuthContext,
    query: { startDate?: string; endDate?: string }
  ): Promise<StackTimeReportByPerson[]> {
    await this.requireAdmin(auth);
    await this.ensureDefaultProjects();

    const entries = await this.store.listAllEntries({
      startDate: query.startDate,
      endDate: query.endDate
    });

    const personMap = new Map<string, StackTimeReportByPerson>();

    for (const entry of entries) {
      let person = personMap.get(entry.userId);
      if (!person) {
        person = {
          userId: entry.userId,
          displayName: entry.userDisplayName ?? entry.userId,
          totalHours: 0,
          entryCount: 0,
          byProject: []
        };
        personMap.set(entry.userId, person);
      }

      person.totalHours += entry.hours;
      person.entryCount += 1;

      // Update project breakdown
      const projectEntry = person.byProject.find((p) => p.projectId === entry.projectId);
      if (projectEntry) {
        projectEntry.totalHours += entry.hours;
        projectEntry.entryCount += 1;
      } else {
        person.byProject.push({
          projectId: entry.projectId,
          projectName: entry.projectName ?? entry.projectId,
          totalHours: entry.hours,
          entryCount: 1
        });
      }
    }

    // Sort by total hours
    const result = Array.from(personMap.values()).sort((a, b) => b.totalHours - a.totalHours);
    // Sort each person's projects by hours
    for (const person of result) {
      person.byProject.sort((a, b) => b.totalHours - a.totalHours);
    }

    return result;
  }

  async getTimelineStats(
    auth: AuthContext,
    query: { startDate?: string; endDate?: string }
  ): Promise<TimelineStatsResponse> {
    await this.requireAdmin(auth);
    await this.ensureDefaultProjects();

    // Default to last 12 weeks if no dates provided
    const endDate = query.endDate ?? new Date().toISOString().split("T")[0];
    const startDate =
      query.startDate ??
      new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const entries = await this.store.listAllEntries({ startDate, endDate });

    // Helper to get Monday of a week
    const getWeekStart = (dateStr: string): string => {
      const date = new Date(dateStr + "T12:00:00");
      const day = date.getDay();
      const diff = day === 0 ? -6 : 1 - day; // Monday is 1, Sunday is 0
      date.setDate(date.getDate() + diff);
      return date.toISOString().split("T")[0];
    };

    // Helper to get Sunday of a week
    const getWeekEnd = (weekStart: string): string => {
      const date = new Date(weekStart + "T12:00:00");
      date.setDate(date.getDate() + 6);
      return date.toISOString().split("T")[0];
    };

    // Generate all weeks in the period
    const allWeeks: string[] = [];
    let currentWeekStart = getWeekStart(startDate);
    const periodEnd = getWeekStart(endDate);
    while (currentWeekStart <= periodEnd) {
      allWeeks.push(currentWeekStart);
      const nextWeek = new Date(currentWeekStart + "T12:00:00");
      nextWeek.setDate(nextWeek.getDate() + 7);
      currentWeekStart = nextWeek.toISOString().split("T")[0];
    }

    // Build member stats
    const memberMap = new Map<
      string,
      {
        userId: string;
        displayName: string;
        entries: typeof entries;
        weeklyHours: Map<string, { hours: number; entryCount: number }>;
        projectHours: Map<string, { projectName: string; hours: number; entryCount: number }>;
        uniqueDays: Set<string>;
      }
    >();

    for (const entry of entries) {
      let member = memberMap.get(entry.userId);
      if (!member) {
        member = {
          userId: entry.userId,
          displayName: entry.userDisplayName ?? entry.userId,
          entries: [],
          weeklyHours: new Map(),
          projectHours: new Map(),
          uniqueDays: new Set()
        };
        memberMap.set(entry.userId, member);
      }

      member.entries.push(entry);
      member.uniqueDays.add(entry.date);

      // Weekly breakdown
      const weekStart = getWeekStart(entry.date);
      const weekData = member.weeklyHours.get(weekStart) ?? { hours: 0, entryCount: 0 };
      weekData.hours += entry.hours;
      weekData.entryCount += 1;
      member.weeklyHours.set(weekStart, weekData);

      // Project breakdown
      const projectData = member.projectHours.get(entry.projectId) ?? {
        projectName: entry.projectName ?? entry.projectId,
        hours: 0,
        entryCount: 0
      };
      projectData.hours += entry.hours;
      projectData.entryCount += 1;
      member.projectHours.set(entry.projectId, projectData);
    }

    // Build response
    const members: MemberTimelineStats[] = [];

    for (const [userId, data] of memberMap) {
      const sortedEntries = data.entries.sort((a, b) => a.date.localeCompare(b.date));
      const totalHours = data.entries.reduce((sum, e) => sum + e.hours, 0);
      const entryCount = data.entries.length;

      // Build weekly breakdown with zeros for inactive weeks
      const weeklyBreakdown: WeeklyBreakdown[] = allWeeks.map((weekStart) => {
        const weekData = data.weeklyHours.get(weekStart);
        return {
          weekStart,
          weekEnd: getWeekEnd(weekStart),
          hours: weekData?.hours ?? 0,
          entryCount: weekData?.entryCount ?? 0
        };
      });

      // Count active weeks (weeks with > 0 hours)
      const activeWeeks = weeklyBreakdown.filter((w) => w.hours > 0).length;

      members.push({
        userId,
        displayName: data.displayName,
        totalHours,
        entryCount,
        avgHoursPerEntry: entryCount > 0 ? Math.round((totalHours / entryCount) * 100) / 100 : 0,
        avgHoursPerWeek: activeWeeks > 0 ? Math.round((totalHours / activeWeeks) * 100) / 100 : 0,
        activeDays: data.uniqueDays.size,
        firstEntryDate: sortedEntries.length > 0 ? sortedEntries[0].date : null,
        lastEntryDate: sortedEntries.length > 0 ? sortedEntries[sortedEntries.length - 1].date : null,
        weeklyBreakdown,
        byProject: Array.from(data.projectHours.entries())
          .map(([projectId, proj]) => ({
            projectId,
            projectName: proj.projectName,
            totalHours: proj.hours,
            entryCount: proj.entryCount
          }))
          .sort((a, b) => b.totalHours - a.totalHours)
      });
    }

    // Sort members by total hours
    members.sort((a, b) => b.totalHours - a.totalHours);

    return {
      startDate,
      endDate,
      totalHours: entries.reduce((sum, e) => sum + e.hours, 0),
      totalEntries: entries.length,
      activeMembers: members.length,
      weeksInPeriod: allWeeks.length,
      members
    };
  }
}
