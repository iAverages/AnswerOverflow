// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
	getMainSiteHostname,
	isOnMainSite,
} from '@answeroverflow/constants/src/links';

function dataUnlockerRouteHandler(req: NextRequest) {
	const rewrite = NextResponse.rewrite(
		new URL(
			`${req.nextUrl.pathname}${req.nextUrl.search}`,
			`https://oemf7z50uh7w.ddns.dataunlocker.com/`,
		),
	);
	rewrite.headers.set('host', getMainSiteHostname());
	rewrite.headers.set('x-forwarded-for', req.ip!);
	return rewrite;
}

export function middleware(req: NextRequest) {
	const url = req.nextUrl;
	const path = url.pathname + url.search;

	if (path.startsWith('/oemf7z50uh7w/')) {
		return dataUnlockerRouteHandler(req);
	}
	const host = req.headers.get('host')!;
	if (path.startsWith('/og')) {
		return NextResponse.next();
	}

	if (isOnMainSite(host)) {
		return NextResponse.next();
	}
	// rewrite everything else to `/[domain]/[path] dynamic route
	const newUrl = new URL(`/${host}${path}`, req.url);
	return NextResponse.rewrite(newUrl);
}
// See "Matching Paths" below to learn more
export const config = {
	matcher: [
		// Data Unlocker
		'/oemf7z50uh7w/:path*',
		/*
		 * Match all paths except for:
		 * 1. /_next (Next.js internals)
		 * 2. /examples (inside /public)
		 * 3. all root files inside /public (e.g. /favicon.ico)
		 */
		'/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)',
		'/sitemap.xml',
		'/robots.txt',
	],
};
