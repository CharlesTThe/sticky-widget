# Other frameworks

The widget is plain JavaScript with no framework dependency. Anything that can run code
once in the browser can start it. Start it when the app mounts and stop it on unmount, and
it follows client-side routing by itself.

## Vue 3

```js
// App.vue <script setup>
import { onMounted, onUnmounted } from 'vue';
import FeedbackKit from 'feedback-kit';

onMounted(() => FeedbackKit.init({ endpoint: '/api/feedback' }));
onUnmounted(() => FeedbackKit.destroy());
```

## Svelte / SvelteKit

```svelte
<!-- +layout.svelte -->
<script>
  import { onMount } from 'svelte';
  import FeedbackKit from 'feedback-kit';
  onMount(() => {
    FeedbackKit.init({ endpoint: '/api/feedback' });
    return () => FeedbackKit.destroy();
  });
</script>
<slot />
```

## Angular

```ts
// app.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import FeedbackKit from 'feedback-kit';

@Component({ selector: 'app-root', templateUrl: './app.component.html' })
export class AppComponent implements OnInit, OnDestroy {
  ngOnInit() { FeedbackKit.init({ endpoint: '/api/feedback' }); }
  ngOnDestroy() { FeedbackKit.destroy(); }
}
```

## Any page, no build step

```html
<script src="https://your-feedback-server.example.com/feedback-kit.js"
        data-endpoint="https://your-feedback-server.example.com/api/feedback"></script>
```

or, to keep comments in the browser only:

```html
<script src="feedback-kit.js" data-mode="local"></script>
```

## Routes that are not paths

By default a "page" is `origin + pathname`. If your app routes on the hash or the query
string, or one URL shows several different things, say what a page is:

```js
FeedbackKit.init({
  endpoint: '/api/feedback',
  pageId: () => location.pathname + location.hash   // re-read on every navigation
});
```
