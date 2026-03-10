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
import { TuiCheckbox, TuiInputSlider, TuiPulse } from '@taiga-ui/kit';
import { debounceTime, startWith } from 'rxjs';

@Component({
  selector: 'app-main',
  imports: [ReactiveFormsModule, TuiInputSlider, TuiTextfield, TuiPulse, TuiCheckbox],
  templateUrl: './main.html',
  styleUrl: './main.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Main {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isEnabled = signal(false);

  readonly statusClass = computed(() => (this.isEnabled() ? 'text-green-500!' : 'text-red-500!'));

  protected readonly form = new FormGroup({
    deviation: new FormControl(10, { nonNullable: true }),
    frequency: new FormControl(1000, { nonNullable: true }),
    smoothness: new FormControl(10, { nonNullable: true }),
    keepFocusOnTitle: new FormControl(false, { nonNullable: true }),
    focusInterval: new FormControl(3000, { nonNullable: true }),
    foregroundWindowTitle: new FormControl('', { nonNullable: true }),
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
    });

    this.form.valueChanges
      .pipe(startWith(this.form.getRawValue()), debounceTime(100), takeUntilDestroyed())
      .subscribe((rawSettings) => {
        const settings = {
          deviation: rawSettings.deviation ?? 10,
          frequency: rawSettings.frequency ?? 1000,
          smoothness: rawSettings.smoothness ?? 10,
          keepFocusOnTitle: rawSettings.keepFocusOnTitle ?? false,
          focusInterval: rawSettings.focusInterval ?? 3000,
          foregroundWindowTitle: rawSettings.foregroundWindowTitle ?? '',
        };

        api.updateSettings(settings);
      });
  }

  private applyState(state: JigglerState): void {
    this.isEnabled.set(state.enabled);

    this.form.patchValue(state.settings, { emitEvent: false });
    this.cdr.markForCheck();
  }
}
