import type { FeedbackOptions } from './index.js';

export interface FeedbackWidgetProps extends FeedbackOptions {
  /** Render nothing and keep the widget off, e.g. for signed-out users or production. */
  disabled?: boolean;
}

/** Starts the feedback widget while mounted. Renders nothing itself. */
export function FeedbackWidget(props: FeedbackWidgetProps): null;
export default FeedbackWidget;
