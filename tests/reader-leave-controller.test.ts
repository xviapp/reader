import { describe, expect, it, vi } from 'vitest';

import { createReaderLeaveController } from '@/modules/reader/ui/reader-leave-controller';

describe('Reader 原生导航离开保护', () => {
  it('没有草稿保护时正常导航', () => {
    const leave = createReaderLeaveController();
    const action = vi.fn();
    leave.request(action);
    expect(leave.getSnapshot()).toBe(false);
    expect(action).toHaveBeenCalledOnce();
  });

  it('先保存或清理草稿，再解除原生拦截并执行原来的返回动作', () => {
    const leave = createReaderLeaveController();
    const action = vi.fn();
    const fallback = vi.fn();
    const guard = vi.fn();
    const changed = vi.fn();
    const unsubscribe = leave.subscribe(changed);
    leave.register(guard);
    expect(leave.getSnapshot()).toBe(true);
    leave.request(action);
    expect(guard).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
    leave.confirm(fallback);
    expect(leave.getSnapshot()).toBe(false);
    expect(action).not.toHaveBeenCalled();
    leave.flush();
    leave.flush();
    expect(action).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('取消后不会在下一次返回时执行之前的侧栏跳转', () => {
    const leave = createReaderLeaveController();
    const sidebar = vi.fn();
    const back = vi.fn();
    leave.register((cancel) => cancel());
    leave.request(sidebar);
    expect(leave.getSnapshot()).toBe(true);
    leave.confirm(back);
    leave.flush();
    expect(sidebar).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledOnce();
  });

  it('连续按返回不会重复弹窗，重新聚焦后恢复保护', () => {
    const leave = createReaderLeaveController();
    const guard = vi.fn();
    leave.register(guard);
    leave.request(vi.fn());
    leave.request(vi.fn());
    expect(guard).toHaveBeenCalledOnce();
    leave.confirm(vi.fn());
    leave.flush();
    leave.reset();
    expect(leave.getSnapshot()).toBe(true);
    leave.request(vi.fn());
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it('页面内保存成功可以直接替换表单，不会再次询问', () => {
    const leave = createReaderLeaveController();
    const guard = vi.fn();
    const replace = vi.fn();
    leave.register(guard);
    leave.confirm(replace);
    expect(leave.getSnapshot()).toBe(false);
    leave.flush();
    expect(guard).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledOnce();
  });

  it('旧弹窗的取消回调不会清掉新的离开请求', () => {
    const leave = createReaderLeaveController();
    const cancels: (() => void)[] = [];
    leave.register((cancel) => cancels.push(cancel));
    leave.request(vi.fn());
    cancels[0]!();
    const next = vi.fn();
    leave.request(next);
    cancels[0]!();
    leave.confirm(vi.fn());
    leave.flush();
    expect(next).toHaveBeenCalledOnce();
  });
});
