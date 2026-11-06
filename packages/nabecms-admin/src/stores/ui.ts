import { defineStore } from "pinia";

type UiState = {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
};

const STORAGE_KEY = "nabecms_admin_ui";

/**
 * Read persisted UI preferences while keeping transient mobile state ephemeral.
 */
function loadState(): UiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Pick<UiState, "sidebarCollapsed">>;
      return {
        sidebarCollapsed: parsed.sidebarCollapsed ?? false,
        mobileSidebarOpen: false,
      };
    }
  } catch {}

  return {
    sidebarCollapsed: false,
    mobileSidebarOpen: false,
  };
}

export const useUiStore = defineStore("ui", {
  state: (): UiState => loadState(),
  actions: {
    /**
     * Toggle the desktop sidebar collapse preference.
     */
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      this.persist();
    },
    /**
     * Persist a desktop sidebar collapse preference.
     */
    setSidebar(collapsed: boolean) {
      this.sidebarCollapsed = collapsed;
      this.persist();
    },
    /**
     * Toggle the transient mobile drawer state.
     */
    toggleMobileSidebar() {
      this.mobileSidebarOpen = !this.mobileSidebarOpen;
    },
    /**
     * Open the mobile drawer.
     */
    openMobileSidebar() {
      this.mobileSidebarOpen = true;
    },
    /**
     * Close the mobile drawer.
     */
    closeMobileSidebar() {
      this.mobileSidebarOpen = false;
    },
    /**
     * Persist stable UI preferences only.
     */
    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sidebarCollapsed: this.sidebarCollapsed }));
      } catch {}
    },
  },
});
