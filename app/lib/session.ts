export function createSessionGuard() {
  let generation = 0;
  let currentUid: string | null = null;
  return {
    update(uid: string | null) {
      if (uid !== currentUid) { generation++; currentUid = uid; }
      const captured = generation;
      return () => generation === captured && uid === currentUid;
    },
    invalidate() { generation++; currentUid = null; },
  };
}
