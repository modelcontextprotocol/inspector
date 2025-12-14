interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="p-8 text-center text-muted-foreground">
      {message}
    </div>
  );
}
