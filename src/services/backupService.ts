import { useHistoryStore } from '../stores/historyStore';
import { useDownloadsStore } from '../stores/downloadsStore';

export interface BackupData {
  version: number;
  exportedAt: string;
  favorites: string[];
  playlists: any[];
  history: any[];
  downloads: string[];
}

export class BackupService {
  async exportData(): Promise<BackupData> {
    let favorites: any[] = [];
    let playlists: any[] = [];
    try { favorites = JSON.parse(localStorage.getItem('favorites') || '[]'); } catch { favorites = []; }
    try { playlists = JSON.parse(localStorage.getItem('playlists') || '[]'); } catch { playlists = []; }
    const history = useHistoryStore.getState().history;
    const downloads = useDownloadsStore.getState().downloads.map(d => d.youtubeId);

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      favorites,
      playlists,
      history,
      downloads,
    };
  }

  async importData(data: BackupData): Promise<{ success: boolean; message: string }> {
    try {
      if (!data || !data.version) {
        return { success: false, message: 'Invalid backup file' };
      }

      // Restore favorites
      if (data.favorites) {
        localStorage.setItem('favorites', JSON.stringify(data.favorites));
      }

      // Restore playlists
      if (data.playlists) {
        localStorage.setItem('playlists', JSON.stringify(data.playlists));
      }

      // Restore history
      if (data.history) {
        const { addSong } = useHistoryStore.getState();
        for (const entry of [...data.history].reverse()) {
          if (entry.song) {
            addSong(entry.song);
          }
        }
      }

      return { success: true, message: 'Library restored successfully!' };
    } catch (error) {
      return { success: false, message: 'Failed to restore: Invalid data format' };
    }
  }

  downloadBackup(data: BackupData): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bloomee-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async restoreFromFile(file: File): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          const result = await this.importData(data);
          resolve(result);
        } catch {
          resolve({ success: false, message: 'Invalid JSON file' });
        }
      };
      reader.onerror = () => resolve({ success: false, message: 'Failed to read file' });
      reader.readAsText(file);
    });
  }
}

export const backupService = new BackupService();
