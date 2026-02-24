import type { PresenceUser } from '@/types';

interface Props {
  users: PresenceUser[];
  max?: number;
}

export function UserAvatarStack({ users, max = 3 }: Props) {
  const visible = users.slice(0, max);
  const overflow = users.length - max;

  return (
    <div className="flex -space-x-2">
      {visible.map((user) => (
        <div
          key={user.userId}
          className="w-6 h-6 rounded-full border-2 border-bg-secondary flex items-center justify-center text-[10px] font-bold text-white"
          style={{ backgroundColor: user.avatarColor }}
          title={user.displayName}
        >
          {user.displayName[0]?.toUpperCase()}
        </div>
      ))}
      {overflow > 0 && (
        <div className="w-6 h-6 rounded-full border-2 border-bg-secondary bg-bg-elevated flex items-center justify-center text-[10px] text-text-muted">
          +{overflow}
        </div>
      )}
    </div>
  );
}
