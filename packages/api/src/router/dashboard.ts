import { Analytics } from '@answeroverflow/core/analytics';
import { findManyChannelsById } from '@answeroverflow/core/channel';
import { findManyDiscordAccountsById } from '@answeroverflow/core/discord-account';
import {
	findServerById,
	findServerByIdWithChannels,
	updateServer,
} from '@answeroverflow/core/server';
import { Stripe } from '@answeroverflow/core/stripe';
import { sharedEnvs } from '@answeroverflow/env/shared';
import { TRPCError, inferProcedureOutput } from '@trpc/server';
import { z } from 'zod';
import { assertCanEditServer } from '../utils/permissions';
import { protectedFetch } from '../utils/protected-procedures';
import { router, withUserServersProcedure } from './trpc';
const input = z.object({
	serverId: z.string(),
	from: z.date(),
	to: z.date(),
});

export const dashboardRouter = router({
	pageViews: withUserServersProcedure
		.input(input)
		.query(async ({ ctx, input }) => {
			const data = await protectedFetch({
				fetch: () => {
					return Analytics.getPageViewsForServer(input);
				},
				permissions: () => assertCanEditServer(ctx, input.serverId),
				notFoundMessage: 'Server not found',
			});
			return data;
		}),
	serverInvitesClicked: withUserServersProcedure
		.input(input)
		.query(async ({ ctx, input }) => {
			const data = await protectedFetch({
				fetch: () => {
					return Analytics.getServerInvitesClicked(input);
				},
				permissions: () => assertCanEditServer(ctx, input.serverId),
				notFoundMessage: 'Server not found',
			});
			return data;
		}),
	questionsAndAnswers: withUserServersProcedure
		.input(input)
		.query(async ({ ctx, input }) => {
			const data = await protectedFetch({
				fetch: () => {
					return Analytics.getQuestionsAndAnswers(input);
				},
				permissions: () => assertCanEditServer(ctx, input.serverId),
				notFoundMessage: 'Server not found',
			});
			return data;
		}),
	topQuestionSolvers: withUserServersProcedure
		.input(input)
		.query(async ({ ctx, input }) => {
			const data = await protectedFetch({
				fetch: async () => {
					const topSolvers =
						await Analytics.getTopQuestionSolversForServer(input);
					const topSolverIds = Object.keys(topSolvers);
					const discordAccounts =
						await findManyDiscordAccountsById(topSolverIds);
					const map = new Map(
						discordAccounts.map((account) => [account.id, account]),
					);
					return topSolverIds.map((id) => ({
						...map.get(id)!,
						questionsSolved: topSolvers[id]?.aggregated_value ?? 0,
					}));
				},
				permissions: () => assertCanEditServer(ctx, input.serverId),
				notFoundMessage: 'Server not found',
			});
			return data;
		}),
	topPages: withUserServersProcedure
		.input(input)
		.query(async ({ ctx, input }) => {
			const data = await protectedFetch({
				fetch: async () => {
					const metadata = await Analytics.getTopPages(input);
					const threadIds = Object.keys(metadata);
					const threads = await findManyChannelsById(threadIds);
					const map = new Map(threads.map((thread) => [thread.id, thread]));
					return threadIds
						.map(
							(id) =>
								map.get(id) && {
									...map.get(id),
									views: metadata[id]?.aggregated_value ?? 0,
								},
						)
						.filter(Boolean);
				},
				permissions: () => assertCanEditServer(ctx, input.serverId),
				notFoundMessage: 'Server not found',
			});
			return data;
		}),
	fetchDashboardById: withUserServersProcedure
		.input(z.string())
		.query(async ({ input, ctx }) =>
			protectedFetch({
				fetch: async () => {
					const server = await findServerByIdWithChannels(input);
					if (!server) {
						throw new TRPCError({
							code: 'NOT_FOUND',
							message: 'Server not found',
						});
					}

					if (server.stripeCustomerId) {
						// Update the customer's name and description
						// We can just let this run in the background and not await it
						void Stripe.updateServerCustomerName({
							serverId: server.id,
							name: server.name,
							customerId: server.stripeCustomerId,
						});
					}

					// If they have a subscription already, we display the portal
					if (server.stripeCustomerId && server.stripeSubscriptionId) {
						const sub = await Stripe.fetchSubscriptionInfo(
							server.stripeSubscriptionId,
						);
						const {
							cancel_at: cancelAt, // This is when a cancellation will take effect
							current_period_end: currentPeriodEnd, // This is when an active subscription will renew
							trial_end: trialEnd, // This is when a trial will end
							// get when subscription will renew
						} = sub;

						return {
							...server,
							status: 'active',
							stripeCheckoutUrl: sharedEnvs.STRIPE_CHECKOUT_URL ?? null,
							dateCancelationTakesEffect: cancelAt,
							dateSubscriptionRenews: currentPeriodEnd,
							dateTrialEnds: trialEnd,
							hasSubscribedBefore: undefined,
							proPlanCheckoutUrl: undefined,
							enterprisePlanCheckoutUrl: undefined,
						} as const;
					}

					// else we upsert them and then display checkout

					if (!server.stripeCustomerId) {
						const customer = await Stripe.createNewCustomer({
							name: server.name,
							serverId: server.id,
						});
						server.stripeCustomerId = customer.id;
						await updateServer({
							existing: server,
							update: {
								id: server.id,
								stripeCustomerId: customer.id,
							},
						});
					}

					const returnUrl = `https://app.answeroverflow.com/dashboard/${server.id}`;

					const [proPlanCheckout, enterprisePlanCheckout] = await Promise.all([
						Stripe.createProPlanCheckoutSession({
							customerId: server.stripeCustomerId,
							successUrl: returnUrl,
							cancelUrl: returnUrl,
						}),
						Stripe.createEnterprisePlanCheckoutSession({
							customerId: server.stripeCustomerId,
							successUrl: returnUrl,
							cancelUrl: returnUrl,
						}),
					]);

					return {
						...server,
						status: 'inactive',
						stripeCheckoutUrl: undefined,
						hasSubscribedBefore:
							proPlanCheckout.hasSubscribedInPast ||
							enterprisePlanCheckout.hasSubscribedInPast,
						proPlanCheckoutUrl: proPlanCheckout.url,
						enterprisePlanCheckoutUrl: enterprisePlanCheckout.url,
						dateCancelationTakesEffect: null,
						dateSubscriptionRenews: null,
						dateTrialEnds: null,
					} as const;
				},
				notFoundMessage: 'Server not found',
				permissions: () => assertCanEditServer(ctx, input),
			}),
		),
});

export type ServerDashboard = inferProcedureOutput<
	(typeof dashboardRouter)['fetchDashboardById']
>;
