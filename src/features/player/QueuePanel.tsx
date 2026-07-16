import React, { useState } from 'react';
import { useQueueStore } from '../../stores/queueStore';
import { useAudioStore } from '../../stores/audioStore';
import { cn } from '../../utils/cn';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  X,
  Trash2,
  Shuffle,
  Repeat,
  Repeat1,
  Clock,
  Music,
  Play,
  Pause,
} from 'lucide-react';

// ---- Sortable song row ----

interface SortableSongRowProps {
  song: import('../../types/music').Song;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  section: 'current' | 'upcoming' | 'recent';
}

const SortableSongRow: React.FC<SortableSongRowProps> = ({ song, index, isCurrent, isPlaying, section }) => {
  const playAtIndex = useQueueStore((s) => s.playAtIndex);
  const removeFromQueue = useQueueStore((s) => s.removeFromQueue);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id + '-' + index });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-xl group transition-all duration-200",
        isCurrent && "bg-violet-500/15 border border-violet-500/20",
        !isCurrent && "hover:bg-white/5",
        isDragging && "shadow-lg shadow-violet-500/20"
      )}
    >
      {/* Drag handle */}
      {section !== 'recent' && (
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 touch-none"
        >
          <GripVertical size={14} />
        </button>
      )}
      {section === 'recent' && <div className="w-[14px]" />}

      {/* Index / play indicator */}
      <div className="w-6 text-center flex-shrink-0">
        {isCurrent ? (
          <div className="flex items-center justify-center gap-0.5">
            {isPlaying ? (
              <div className="flex items-end gap-0.5 h-3">
                <div className="w-0.5 bg-violet-400 rounded-full animate-[eq-bounce_0.8s_ease-in-out_infinite]" style={{ animationDelay: '0s' }} />
                <div className="w-0.5 bg-violet-400 rounded-full animate-[eq-bounce_0.8s_ease-in-out_infinite]" style={{ animationDelay: '0.1s' }} />
                <div className="w-0.5 bg-violet-400 rounded-full animate-[eq-bounce_0.8s_ease-in-out_infinite]" style={{ animationDelay: '0.2s' }} />
              </div>
            ) : (
              <Pause size={12} className="text-violet-400" />
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-600">{index + 1}</span>
        )}
      </div>

      {/* Cover art */}
      <div className="w-9 h-9 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
        {song.coverArt ? (
          <img src={song.coverArt} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music size={14} className="text-gray-600" />
          </div>
        )}
      </div>

      {/* Song info */}
      <button
        onClick={() => section !== 'recent' ? playAtIndex(index) : undefined}
        className="flex-1 min-w-0 text-left"
        disabled={section === 'recent'}
      >
        <p className={cn(
          "text-sm font-medium truncate",
          isCurrent ? "text-violet-300" : "text-white"
        )}>
          {song.title}
        </p>
        <p className="text-xs text-gray-500 truncate">{song.artist}</p>
      </button>

      {/* Duration */}
      <span className="text-xs text-gray-600 flex-shrink-0">{formatDuration(song.duration)}</span>

      {/* Remove button */}
      {section !== 'recent' && (
        <button
          onClick={() => removeFromQueue(index)}
          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all flex-shrink-0"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

// ---- Queue Panel ----

export const QueuePanel: React.FC = () => {
  const {
    queue, currentIndex, recentlyPlayed, repeatMode, isShuffled,
    reorderQueue, clearQueue, toggleShuffle, cycleRepeat, clearRecent,
  } = useQueueStore();
  const { currentSong, isPlaying } = useAudioStore();
  const [tab, setTab] = useState<'queue' | 'recent'>('queue');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = queue.findIndex((s, i) => (s.id + '-' + i) === String(active.id));
    const newIndex = queue.findIndex((s, i) => (s.id + '-' + i) === String(over.id));
    if (oldIndex !== -1 && newIndex !== -1) {
      reorderQueue(oldIndex, newIndex);
    }
  };

  const upcoming = queue.slice(currentIndex + 1);
  const currentInQueue = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab('queue')}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              tab === 'queue' ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"
            )}
          >
            Queue {queue.length > 0 && <span className="ml-1 text-gray-600">({queue.length})</span>}
          </button>
          <button
            onClick={() => setTab('recent')}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              tab === 'recent' ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"
            )}
          >
            Recently Played
          </button>
        </div>

        {/* Queue controls */}
        {tab === 'queue' && (
          <div className="flex items-center gap-1">
            <button
              onClick={toggleShuffle}
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center transition-all",
                isShuffled ? "text-violet-400 bg-violet-500/15" : "text-gray-600 hover:text-gray-400"
              )}
              title={isShuffled ? "Shuffle On" : "Shuffle Off"}
            >
              <Shuffle size={13} />
            </button>
            <button
              onClick={cycleRepeat}
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center transition-all relative",
                repeatMode !== 'off' ? "text-emerald-400 bg-emerald-500/15" : "text-gray-600 hover:text-gray-400"
              )}
              title={`Repeat: ${repeatMode}`}
            >
              <RepeatIcon size={13} />
              {repeatMode === 'one' && (
                <span className="absolute -top-0.5 -right-0.5 text-[6px] font-bold bg-emerald-500 text-white rounded-full w-3 h-3 flex items-center justify-center">
                  1
                </span>
              )}
            </button>
            <button
              onClick={clearQueue}
              className="w-7 h-7 rounded-full flex items-center justify-center text-gray-600 hover:text-red-400 transition-all"
              title="Clear Queue"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
        {tab === 'recent' && recentlyPlayed.length > 0 && (
          <button
            onClick={clearRecent}
            className="text-xs text-gray-600 hover:text-red-400 transition-all"
          >
            Clear
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {tab === 'queue' ? (
          queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Music size={32} className="mb-3 text-gray-700" />
              <p className="text-sm">Queue is empty</p>
              <p className="text-xs text-gray-700 mt-1">Add songs to start playing</p>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Now Playing */}
              {currentInQueue && (
                <div className="mb-3">
                  <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider px-3 mb-1.5">Now Playing</p>
                  <SortableSongRow
                    song={currentInQueue}
                    index={currentIndex}
                    isCurrent={true}
                    isPlaying={isPlaying}
                    section="current"
                  />
                </div>
              )}

              {/* Up Next */}
              {upcoming.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider px-3 mb-1.5">
                    Up Next
                    <span className="ml-1 text-gray-700">({upcoming.length})</span>
                  </p>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={upcoming.map((s, i) => s.id + '-' + (currentIndex + 1 + i))} strategy={verticalListSortingStrategy}>
                      {upcoming.map((song, i) => (
                        <SortableSongRow
                          key={song.id + '-' + (currentIndex + 1 + i)}
                          song={song}
                          index={currentIndex + 1 + i}
                          isCurrent={false}
                          isPlaying={false}
                          section="upcoming"
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              )}
            </div>
          )
        ) : (
          /* Recently Played tab */
          recentlyPlayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Clock size={32} className="mb-3 text-gray-700" />
              <p className="text-sm">No recently played songs</p>
            </div>
          ) : (
            <div className="space-y-1">
              {recentlyPlayed.map((song, i) => (
                <div
                  key={song.id + '-' + i}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-all group",
                    currentSong?.id === song.id && "bg-violet-500/10"
                  )}
                >
                  <div className="w-6 text-center flex-shrink-0">
                    {currentSong?.id === song.id ? (
                      <Play size={12} className="text-violet-400 mx-auto" />
                    ) : (
                      <span className="text-xs text-gray-600">{i + 1}</span>
                    )}
                  </div>
                  <div className="w-9 h-9 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                    {song.coverArt ? (
                      <img src={song.coverArt} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music size={14} className="text-gray-600" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium truncate", currentSong?.id === song.id ? "text-violet-300" : "text-white")}>
                      {song.title}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{song.artist}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
};
