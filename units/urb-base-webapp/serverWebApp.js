// @flow

import path from 'path'

import createRender from 'found/lib/createRender'
import { getFarceResult } from 'found/lib/server'
import express from 'express'
import Helmet from 'react-helmet'
import React from 'react'
import { JssProvider, SheetsRegistry } from 'react-jss'
import ReactDOMServer from 'react-dom/server'
import serialize from 'serialize-javascript'

import ErrorComponent from '../_configuration/urb-base-webapp/ErrorComponent'
import getGraphQLLocalServerURL from '../_configuration/urb-base-server/getGraphQLLocalServerURL'
import { getSiteInformation } from '../_configuration/urb-base-server/siteSettings'
import log from '../urb-base-server/log'
import { version } from '../_configuration/package'
import UserToken2ServerRendering from '../_configuration/urb-base-server/UserToken2ServerRendering'
import AppWrapper from '../_configuration/urb-base-webapp/AppWrapper'

import FetcherServer from './fetcherServer'
import { createResolver, historyMiddlewares, routeConfig } from './router'

// Read environment
require( 'dotenv' ).load()

const envHost = process.env.HOST
if ( envHost == null || typeof envHost !== 'string' )
  throw new Error( 'Error: urb-base-webapp requires the environment variable HOST to be set' )
const envPort = process.env.PORT
if ( envPort == null || typeof envPort !== 'string' )
  throw new Error( 'Error: urb-base-webapp requires the environment variable PORT to be set' )
const envPortWebpack = process.env.PORT_WEBPACK
if ( envPortWebpack == null || typeof envPortWebpack !== 'string' )
  throw new Error( 'Error: urb-base-webapp requires the environment variable PORT_WEBPACK to be set' ) // Create express router

const serverWebApp = express()

async function gatherLocationAndSiteInformation( req: Object, res: Object ) {
  let assetsPath
  const siteInformation = await getSiteInformation( req, res )
  if ( process.env.NODE_ENV === 'production' ) {
    assetsPath =
      siteInformation.isSiteBuilderDisabled || siteInformation.inEditingMode
        ? // When editing in production, use the assets with the configuration readign code intact (built when cutting a site version)
          `/assets/${version}`
        : // When in production mode, serve the assets compiled by factory's publisher
          `/sassets/${version}.${siteInformation.siteConfiguration.version}`
  } else {
    // When in development, always go to webpack over http
    assetsPath = `http://${envHost}:${envPortWebpack}/${version}`
  }
  return { siteInformation, assetsPath }
}
const render = createRender({
  renderError( obj: Object ): React$Element<*> {
    const { error } = obj
    if ( error.status !== 404 )
      log.log( 'error', 'Error: Render on server createRender renderError', obj )
    return <ErrorComponent httpStatus={error.status} />
  },
})
serverWebApp.use( async( req, res ) => {
  try {
    const { siteInformation, assetsPath } = await gatherLocationAndSiteInformation( req, res )

    const fetcher = new FetcherServer(
      `http://localhost:${envPort}` + getGraphQLLocalServerURL( siteInformation ),
      req.cookies.UserToken1,
      UserToken2ServerRendering,
    )

    const { redirect, element } = await getFarceResult({
      url: req.url,
      historyMiddlewares,
      routeConfig,
      resolver: createResolver( fetcher ),
      render,
    })

    if ( redirect ) {
      res.redirect( 302, redirect.url )
      return
    }

    const userAgent = req.headers['user-agent']
    const { siteConfiguration } = siteInformation
    const siteConfigurationSubset = {
      webapp: siteConfiguration.webapp,
      builder: siteConfiguration.builder,
    }

    const sheets = new SheetsRegistry()
    const helmet = Helmet.rewind()
    const rootHTML = ReactDOMServer.renderToString(
      <JssProvider registry={sheets}>
        <AppWrapper userAgent={userAgent} siteConfiguration={siteConfigurationSubset}>
          {element}
        </AppWrapper>
      </JssProvider>,
    )

    res.render( path.resolve( __dirname, 'html.ejs' ), {
      assets_path: assetsPath,
      root_html: rootHTML,
      server_side_styles: sheets.toString(),
      helmet,
      siteConfiguration: JSON.stringify( siteConfigurationSubset ),
      relay_payload: serialize( fetcher, { isJSON: true }),
    })
  } catch ( err ) {
    log.log( 'error', 'Error: Render on server request', err )
    res.status( 500 ).send( ReactDOMServer.renderToString( <ErrorComponent httpStatus={500} /> ) )
  }
})
export default serverWebApp
