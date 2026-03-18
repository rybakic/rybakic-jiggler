import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TuiTextfield } from '@taiga-ui/core';
import { TuiInputRange, TuiPulse, TuiSwitch } from '@taiga-ui/kit';
import { debounceTime } from 'rxjs';

@Component({
  selector: 'app-main',
  imports: [ReactiveFormsModule, TuiInputRange, TuiTextfield, TuiPulse, TuiSwitch],
  templateUrl: './main.html',
  styleUrl: './main.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Main {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private timerId: number | null = null;
  private lastStartAt: number | null = null;
  private accumulatedMs = 0;

  protected readonly isEnabled = signal(false);
  protected readonly elapsedMs = signal(0);
  protected readonly showMicroFields = signal(false);
  protected readonly showFocusFields = signal(false);
  protected readonly showKeypressFields = signal(false);
  protected readonly showScrollFields = signal(false);
  protected readonly showClickFields = signal(false);
  protected readonly isInitialized = signal(false);

  readonly statusClass = computed(() => (this.isEnabled() ? 'text-green-500!' : 'text-red-500!'));
  protected readonly workTime = computed(() => this.formatDuration(this.elapsedMs()));

  protected readonly form = new FormGroup({
    enableMicroJiggle: new FormControl(false, { nonNullable: true }),
    deviation: new FormControl<readonly [number, number]>([4, 12], { nonNullable: true }),
    frequency: new FormControl<readonly [number, number]>([700, 1400], { nonNullable: true }),
    smoothness: new FormControl<readonly [number, number]>([6, 12], { nonNullable: true }),
    enableKeypress: new FormControl(false, { nonNullable: true }),
    keypressInterval: new FormControl<readonly [number, number]>([6000, 12000], { nonNullable: true }),
    enableScroll: new FormControl(false, { nonNullable: true }),
    scrollInterval: new FormControl<readonly [number, number]>([7000, 13000], { nonNullable: true }),
    scrollAmount: new FormControl<readonly [number, number]>([60, 160], { nonNullable: true }),
    enableClick: new FormControl(false, { nonNullable: true }),
    clickInterval: new FormControl<readonly [number, number]>([8000, 15000], { nonNullable: true }),
    keepFocusOnTitle: new FormControl(true, { nonNullable: true }),
    focusInterval: new FormControl<readonly [number, number]>([2500, 4500], { nonNullable: true }),
    cornerInterval: new FormControl<readonly [number, number]>([2500, 4500], { nonNullable: true }),
    foregroundWindowTitle: new FormControl('', { nonNullable: true }),
    enableCornerSmoothing: new FormControl(false, { nonNullable: true }),
  });

  constructor() {
    const api = window.jigglerApi;

    if (!api) {
      return;
    }

    api.getState().then((state) => {
      this.applyState(state);
    });

    const unsubscribe = api.onStateChange((state) => {
      this.applyState(state);
    });

    this.destroyRef.onDestroy(() => {
      unsubscribe();
      this.stopTimer();
    });

    this.form.valueChanges
      .pipe(debounceTime(100), takeUntilDestroyed())
      .subscribe((rawSettings) => {
        if (!this.isInitialized()) {
          return;
        }
        this.showMicroFields.set(rawSettings.enableMicroJiggle ?? false);
        this.showFocusFields.set(rawSettings.keepFocusOnTitle ?? false);
        this.showKeypressFields.set(rawSettings.enableKeypress ?? false);
        this.showScrollFields.set(rawSettings.enableScroll ?? false);
        this.showClickFields.set(rawSettings.enableClick ?? false);

        const settings = {
          deviation: rawSettings.deviation ?? [4, 12],
          frequency: rawSettings.frequency ?? [700, 1400],
          smoothness: rawSettings.smoothness ?? [6, 12],
          keypressInterval: rawSettings.keypressInterval ?? [6000, 12000],
          enableScroll: rawSettings.enableScroll ?? false,
          scrollInterval: rawSettings.scrollInterval ?? [7000, 13000],
          scrollAmount: rawSettings.scrollAmount ?? [60, 160],
          enableClick: rawSettings.enableClick ?? false,
          clickInterval: rawSettings.clickInterval ?? [8000, 15000],
          keepFocusOnTitle: rawSettings.keepFocusOnTitle ?? true,
          focusInterval: rawSettings.focusInterval ?? [2500, 4500],
          cornerInterval: rawSettings.cornerInterval ?? [2500, 4500],
          foregroundWindowTitle: rawSettings.foregroundWindowTitle ?? '',
          enableMicroJiggle: rawSettings.enableMicroJiggle ?? false,
          enableKeypress: rawSettings.enableKeypress ?? false,
          enableCornerSmoothing: rawSettings.enableCornerSmoothing ?? false,
        };

        api.updateSettings(settings);
      });
  }

  private applyState(state: JigglerState): void {
    const wasEnabled = this.isEnabled();
    this.isEnabled.set(state.enabled);
    if (state.enabled && !wasEnabled) {
      this.startTimer();
    }
    if (!state.enabled && wasEnabled) {
      this.stopTimer();
    }
    this.showMicroFields.set(state.settings.enableMicroJiggle);
    this.showFocusFields.set(state.settings.keepFocusOnTitle);
    this.showKeypressFields.set(state.settings.enableKeypress);
    this.showScrollFields.set(state.settings.enableScroll);
    this.showClickFields.set(state.settings.enableClick);

    this.form.patchValue(state.settings, { emitEvent: false });
    this.isInitialized.set(true);
    this.cdr.markForCheck();
  }

  private startTimer(): void {
    if (this.timerId !== null) {
      return;
    }
    this.lastStartAt = Date.now();
    this.updateElapsed();
    this.timerId = window.setInterval(() => {
      this.updateElapsed();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.lastStartAt !== null) {
      this.accumulatedMs += Date.now() - this.lastStartAt;
      this.lastStartAt = null;
    }
    this.updateElapsed();
  }

  private updateElapsed(): void {
    const extra = this.lastStartAt === null ? 0 : Date.now() - this.lastStartAt;
    this.elapsedMs.set(this.accumulatedMs + extra);
    this.cdr.markForCheck();
  }

  private formatDuration(totalMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
}
