import { effectFiredMutationMustBindCallbacksRule } from '../../src/rules/effect-fired-mutation-must-bind-callbacks';
import { ruleTester } from '../test-utils/ruleTester';

ruleTester.run(
  'effect-fired-mutation-must-bind-callbacks',
  effectFiredMutationMustBindCallbacksRule,
  {
    valid: [
      // The shape the rule exists to protect: handlers on useMutation, a bare
      // call in the effect.
      {
        code: `
          const { mutate } = useMutation({ mutationFn: probe, onSuccess: () => setState('valid') });
          useEffect(() => { mutate({ token }); }, [token, mutate]);
        `,
      },
      // Per-call callbacks from a submit handler are the right tool: they close
      // over that one interaction and the observer is alive by construction.
      {
        code: `function onSubmit(data) { saveMutation.mutate(data, { onSuccess: close }); }`,
      },
      // An effect that fires nothing.
      {
        code: `useEffect(() => { ref.current = true; }, []);`,
      },
      // A second argument that carries no per-call callback is not the defect.
      {
        code: `useEffect(() => { mutate({ token }, { retry: false }); }, []);`,
      },
      // One argument only.
      {
        code: `useEffect(() => { logoutMutation.mutate(); }, []);`,
      },
      // Out of the effect again: the depth counter must come back down.
      {
        code: `
          useEffect(() => { mutate({ token }); }, []);
          function onClick() { mutate({ token }, { onSuccess: close }); }
        `,
      },
    ],
    invalid: [
      // An invite pre-check whose result never reaches the screen, in miniature.
      {
        code: `useEffect(() => { mutate({ token }, { onSuccess: (d) => setState(d.valid) }); }, []);`,
        errors: [{ messageId: 'mustBindToMutation' }],
      },
      // A member call reads the same.
      {
        code: `useEffect(() => { probeMutation.mutate(v, { onError: fail }); }, []);`,
        errors: [{ messageId: 'mustBindToMutation' }],
      },
      // onSettled is delivered by the same gate.
      {
        code: `useEffect(() => { mutate(v, { onSettled: done }); }, []);`,
        errors: [{ messageId: 'mustBindToMutation' }],
      },
      // mutateAsync's per-call options go through the same observer gate.
      {
        code: `useEffect(() => { void mutateAsync(v, { onSuccess: ok }); }, []);`,
        errors: [{ messageId: 'mustBindToMutation' }],
      },
      // Nested inside a helper declared in the effect: still effect-fired.
      {
        code: `useEffect(() => { const run = () => mutate(v, { onSuccess: ok }); run(); }, []);`,
        errors: [{ messageId: 'mustBindToMutation' }],
      },
      // useLayoutEffect is the same hazard.
      {
        code: `useLayoutEffect(() => { mutate(v, { onSuccess: ok }); }, []);`,
        errors: [{ messageId: 'mustBindToMutation' }],
      },
      // React.useEffect member form.
      {
        code: `React.useEffect(() => { mutate(v, { onSuccess: ok }); }, []);`,
        errors: [{ messageId: 'mustBindToMutation' }],
      },
    ],
  },
);
